import {
    GenericObject,
    MidaAsset,
    MidaBrokerAccount,
    MidaBrokerDeal,
    MidaBrokerDealDirection,
    MidaBrokerDealPurpose,
    MidaBrokerDealRejection,
    MidaBrokerDealStatus,
    MidaBrokerPositionDirection,
    MidaDate,
    MidaSymbol,
    MidaSymbolCategory,
    MidaSymbolTick,
} from "@reiryoku/mida";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { CTraderBrokerAccountParameters } from "#brokers/ctrader/CTraderBrokerAccountParameters";


// @ts-ignore
export class CTraderBrokerAccount extends MidaBrokerAccount {
    readonly #connection: CTraderConnection;
    readonly #cTraderBrokerAccountId: string;
    readonly #assets: Map<string, GenericObject>;
    readonly #symbols: Map<string, GenericObject>;
    readonly #tickListeners: Map<string, number>;
    readonly #orders: Map<string, GenericObject>;
    readonly #deals: Map<string, GenericObject>;
    readonly #positions: Map<string, GenericObject>;
    readonly #lastTicks: Map<string, MidaSymbolTick>;

    public constructor ({
        id,
        broker,
        creationDate,
        ownerName,
        currencyIso,
        currencyDigits,
        operativity,
        positionAccounting,
        indicativeLeverage,
        connection,
        cTraderBrokerAccountId,
    }: CTraderBrokerAccountParameters) {
        super({
            id,
            broker,
            creationDate,
            ownerName,
            currencyIso,
            currencyDigits,
            operativity,
            positionAccounting,
            indicativeLeverage,
        });

        this.#connection = connection;
        this.#cTraderBrokerAccountId = cTraderBrokerAccountId;
        this.#assets = new Map();
        this.#symbols = new Map();
        this.#tickListeners = new Map();
        this.#orders = new Map();
        this.#deals = new Map();
        this.#positions = new Map();
        this.#lastTicks = new Map();

        this.#configureListeners();
    }

    public get cTraderBrokerAccountId (): string {
        return this.#cTraderBrokerAccountId;
    }

    public override async getBalance (): Promise<number> {
        const accountDescriptor: GenericObject = await this.#getAccountDescriptor();
        const balance = Number(accountDescriptor.balance.toString());

        if (!Number.isFinite(balance)) {
            throw new Error();
        }

        return balance / 100;
    }

    public override async getUsedMargin (): Promise<number> {
        const accountOperativityStatus: GenericObject = await this.#sendCommand("ProtoOAReconcileReq");
        const plainOpenPositions: GenericObject[] = accountOperativityStatus.position;
        let usedMargin: number = 0;

        for (const plainOpenPosition of plainOpenPositions) {
            usedMargin += Number(plainOpenPosition.usedMargin);
        }

        return usedMargin / 100;
    }

    public override async getEquity (): Promise<number> {
        return 0;
    }

    public override async getAssets (): Promise<MidaAsset[]> {
        await this.#updateAssets();

        return [ ...this.#assets.values(), ].map((asset): MidaAsset => new MidaAsset({
            id: asset.id,
            name: asset.name,
            description: "",
            measurementUnit: "",
        }));
    }

    public override async getSymbols (): Promise<string[]> {
        await this.#updateSymbols();

        return [ ...this.#symbols.values(), ].map((symbol): string => symbol.symbolName);
    }

    public override async getSymbol (symbol: string): Promise<MidaSymbol | undefined> {
        await this.#updateSymbols();

        const symbolDescriptor = this.#symbols.get(symbol);

        if (!symbolDescriptor) {
            return undefined;
        }

        const completeSymbol: GenericObject = (await this.#sendCommand("ProtoOASymbolByIdReq", {
            symbolId: symbolDescriptor.symbolId,
        })).symbol[0];
        const lotUnits = Number(completeSymbol.lotSize) / 100;

        console.log(completeSymbol);

        return new MidaSymbol({
            symbol,
            brokerAccount: this,
            description: symbolDescriptor.description,
            type: MidaSymbolCategory.FOREX,
            digits: completeSymbol.digits,
            leverage: -1, // Not supported
            minLots: Number(completeSymbol.minVolume) / 100 / lotUnits,
            maxLots: Number(completeSymbol.maxVolume) / 100 / lotUnits,
            lotUnits,
        });
    }

    public override async watchSymbolTicks (symbol: string): Promise<void> {
        await this.#updateSymbols();

        const symbolDescriptor = this.#symbols.get(symbol);

        if (!symbolDescriptor) {
            return undefined;
        }

        const listenersCount: number = this.#tickListeners.get(symbol) ?? 0;

        if (listenersCount === 0) {
            await this.#sendCommand("ProtoOASubscribeSpotsReq", {
                symbolId: symbolDescriptor.symbolId,
                // subscribeToSpotTimestamp: true,
            });
        }

        this.#tickListeners.set(symbol, listenersCount + 1);
    }

    public override async getDeals (fromTimestamp?: number, toTimestamp?: number): Promise<MidaBrokerDeal[]> {
        await this.#updateDeals(fromTimestamp ?? Date.now() - 1000 * 60 * 60 * 24, toTimestamp ?? Date.now());

        return [];
    }

    public override async getSymbolLastTick (symbol: string): Promise<MidaSymbolTick> {
        // @ts-ignore
        return this.#lastTicks.get(symbol);
    }

    public override async getSymbolBid (symbol: string): Promise<number> {
        return (await this.getSymbolLastTick(symbol)).bid;
    }

    public override async getSymbolAsk (symbol: string): Promise<number> {
        return (await this.getSymbolLastTick(symbol)).ask;
    }

    // eslint-disable-next-line max-lines-per-function
    public descriptorToDeal (descriptor: GenericObject): MidaBrokerDeal {
        const id = descriptor.dealId.toString();
        const orderId = descriptor.orderId.toString();
        const positionId = descriptor.positionId.toString();
        const symbol = this.#getSymbolDescriptorById(descriptor.symbolId.toString())?.symbolName;
        const requestedVolume = Number(descriptor.volume) / 100;
        const filledVolume = Number(descriptor.filledVolume) / 100;
        let direction: MidaBrokerDealDirection;

        switch (descriptor.tradeSide) {
            case "SELL": {
                direction = MidaBrokerDealDirection.SELL;

                break;
            }
            case "BUY": {
                direction = MidaBrokerDealDirection.BUY;

                break;
            }
            default: {
                throw new Error();
            }
        }

        let status: MidaBrokerDealStatus;
        const rejection: MidaBrokerDealRejection | undefined = undefined;

        switch (descriptor.status) {
            case "PARTIALLY_FILLED": {
                status = MidaBrokerDealStatus.PARTIALLY_FILLED;

                break;
            }
            case "FILLED": {
                status = MidaBrokerDealStatus.FILLED;

                break;
            }
            case "REJECTED":
            case "INTERNALLY_REJECTED":
            case "ERROR":
            case "MISSED": {
                status = MidaBrokerDealStatus.REJECTED;

                break;
            }
            default: {
                throw new Error();
            }
        }

        const purpose: MidaBrokerDealPurpose = descriptor.closePositionDetail ? MidaBrokerDealPurpose.CLOSE : MidaBrokerDealPurpose.OPEN;
        const requestDate = new MidaDate({ timestamp: Number(descriptor.createTimestamp), });
        const executionDate = new MidaDate({ timestamp: Number(descriptor.executionTimestamp), });
        const rejectionDate: MidaDate | undefined = undefined;
        const executionPrice: number = Number(descriptor.executionPrice);
        const grossProfit: number | undefined = ((): number | undefined => {
            if (purpose === MidaBrokerDealPurpose.CLOSE) {
                return Number(descriptor.closePositionDetail.grossProfit) / 100;
            }

            return undefined;
        })();
        const commission: number = Number(descriptor.commission) / 100;
        const swap: number | undefined = ((): number | undefined => {
            if (purpose === MidaBrokerDealPurpose.CLOSE) {
                return Number(descriptor.closePositionDetail.swap) / 100;
            }

            return undefined;
        })();

        return new MidaBrokerDeal({
            id,
            // @ts-ignore
            order: undefined,
            position: undefined,
            symbol,
            requestedVolume,
            filledVolume,
            direction,
            status,
            purpose,
            requestDate,
            executionDate,
            rejectionDate,
            closedByDeals: [],
            closedDeals: [],
            executionPrice,
            grossProfit,
            commission,
            swap,
            rejection,
        });
    }

    async #getAccountDescriptor (): Promise<GenericObject> {
        return (await this.#connection.sendCommand("ProtoOATraderReq", {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
        })).trader;
    }

    async #updateAssets (): Promise<void> {
        const assetsMap: Map<string, GenericObject> = this.#assets;
        const assets: GenericObject[] = (await this.#connection.sendCommand("ProtoOAAssetListReq", {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
        })).asset;

        assetsMap.clear();
        assets.forEach((asset: GenericObject): void => {
            assetsMap.set(asset.name, asset);
        });
    }

    async #updateSymbols (): Promise<void> {
        const symbolsMap: Map<string, GenericObject> = this.#symbols;
        const symbols: GenericObject[] = (await this.#connection.sendCommand("ProtoOASymbolsListReq", {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
        })).symbol;

        symbolsMap.clear();
        symbols.forEach((symbol: GenericObject): void => {
            symbolsMap.set(symbol.symbolName, symbol);
        });
    }

    async #updateDeals (fromTimestamp: number, toTimestamp: number): Promise<void> {
        const dealsMap: Map<string, GenericObject> = this.#deals;
        const deals: GenericObject[] = (await this.#connection.sendCommand("ProtoOADealListReq", {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
            fromTimestamp,
            toTimestamp,
            maxRows: 1000,
        })).deal;

        deals.forEach((deal: GenericObject): void => {
            dealsMap.set(deal.dealId.toString(), deal);
        });
    }

    #onTick (descriptor: GenericObject): void {
        const tick: MidaSymbolTick = new MidaSymbolTick({
            symbol: "BTCUSD",
            bid: Number(descriptor.bid) / 100 / 1000,
            ask: Number(descriptor.ask) / 100 / 1000,
            date: new MidaDate(),
        });
        const symbol: string = tick.symbol;

        this.#lastTicks.set(symbol, tick);

        if (this.#tickListeners.has(symbol)) {
            this.notifyListeners("tick", { tick, });
        }
    }

    #onExecution (descriptor: GenericObject): void {
        console.log(descriptor);
    }

    #configureListeners (): void {
        // <execution>
        this.#connection.on("ProtoOAExecutionEvent", (descriptor: GenericObject): void => {
            if (descriptor.ctidTraderAccountId.toString() === this.#cTraderBrokerAccountId) {
                this.#onExecution(descriptor);
            }
        });
        // </execution>

        // <ticks>
        this.#connection.on("ProtoOASpotEvent", (descriptor: GenericObject): void => {
            if (descriptor.ctidTraderAccountId.toString() === this.#cTraderBrokerAccountId) {
                this.#onTick(descriptor);
            }
        });
        // </ticks>
    }

    #getSymbolDescriptorById (id: string): GenericObject | undefined {
        return [ ...this.#symbols.values(), ].find((symbol: GenericObject) => symbol.symbolId.toString() === id);
    }

    #getAssetDescriptorById (id: string): GenericObject | undefined {
        return [ ...this.#assets.values(), ].find((asset: GenericObject) => asset.assetId.toString() === id);
    }

    #getOrderDescriptorById (id: string): GenericObject | undefined {
        return [ ...this.#deals.values(), ].find((order: GenericObject) => order.orderId.toString() === id);
    }

    #getDealDescriptorById (id: string): GenericObject | undefined {
        return [ ...this.#deals.values(), ].find((deal: GenericObject) => deal.dealId.toString() === id);
    }

    #getDealsDescriptorsByOrderId (id: string): GenericObject[] {
        return [ ...this.#deals.values(), ].filter((deal: GenericObject) => deal.orderId.toString() === id);
    }

    #getDealsDescriptorsByPositionId (id: string): GenericObject[] {
        return [ ...this.#deals.values(), ].filter((deal: GenericObject) => deal.positionId && deal.positionId.toString() === id);
    }

    #getPositionDescriptorById (id: string): GenericObject | undefined {
        return [ ...this.#positions.values(), ].find((position: GenericObject) => position.positionId.toString() === id);
    }

    async #getPlainPositionGrossProfit (plainPosition: GenericObject): Promise<number> {
        const symbol: string = this.#getSymbolDescriptorById(plainPosition.tradeData.symbolId)?.symbolName;
        const volume: number = Number(plainPosition.tradeData.volume) / 100;
        const entryPrice: number = Number(plainPosition.price);
        const lastSymbolTick: MidaSymbolTick = await this.getSymbolLastTick(symbol);
        const pipSize: number = 1 / Math.pow(10, 2/* pip pos */);
        let direction: MidaBrokerPositionDirection;
        let closePrice: number;

        switch (Number(plainPosition.tradeData.tradeSide)) {
            case 1: { // BUY
                direction = MidaBrokerPositionDirection.LONG;
                closePrice = lastSymbolTick.bid;

                break;
            }
            case 2: { // SELL
                direction = MidaBrokerPositionDirection.SHORT;
                closePrice = lastSymbolTick.ask;

                break;
            }
            default: {
                throw new Error();
            }
        }

        return 0;
    }

    async #sendCommand (payloadType: string, parameters: GenericObject = {}): Promise<GenericObject> {
        return this.#connection.sendCommand(payloadType, {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
            ...parameters,
        });
    }
}
