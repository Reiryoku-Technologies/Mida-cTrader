import {
    GenericObject,
    MidaAsset,
    MidaBrokerAccount,
    MidaBrokerDeal,
    MidaBrokerDealDirection,
    MidaBrokerDealPurpose,
    MidaBrokerDealRejection,
    MidaBrokerDealStatus,
    MidaBrokerOrderDirection,
    MidaBrokerOrderDirectives,
    MidaBrokerOrderPurpose,
    MidaBrokerPositionDirection,
    MidaDate,
    MidaSymbol,
    MidaSymbolCategory,
    MidaSymbolTick,
    MidaUtilities,
} from "@reiryoku/mida";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { CTraderBrokerAccountParameters } from "#brokers/ctrader/CTraderBrokerAccountParameters";
import { CTraderBrokerOrder } from "#brokers/ctrader/orders/CTraderBrokerOrder";

// @ts-ignore
export class CTraderBrokerAccount extends MidaBrokerAccount {
    readonly #connection: CTraderConnection;
    readonly #cTraderBrokerAccountId: string;
    readonly #assets: Map<string, GenericObject>;
    readonly #symbols: Map<string, GenericObject>;
    readonly #completeSymbols: Map<string, GenericObject>;
    readonly #symbolsCategories: Map<string, GenericObject>;
    readonly #tickListeners: Map<string, number>;
    readonly #orders: Map<string, GenericObject>;
    readonly #deals: Map<string, GenericObject>;
    readonly #positions: Map<string, GenericObject>;
    readonly #lastTicks: Map<string, MidaSymbolTick>;
    readonly #internalTickListeners: Map<string, Function>;

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
        this.#completeSymbols = new Map();
        this.#symbolsCategories = new Map();
        this.#tickListeners = new Map();
        this.#orders = new Map();
        this.#deals = new Map();
        this.#positions = new Map();
        this.#lastTicks = new Map();
        this.#internalTickListeners = new Map();

        this.#configureListeners();
    }

    public get cTraderBrokerAccountId (): string {
        return this.#cTraderBrokerAccountId;
    }

    public async preloadAssetsAndSymbols (): Promise<void> {
        await Promise.all([ this.#preloadAssets(), this.#preloadSymbols(), ]);
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
        const accountOperativityStatus: GenericObject = await this.#sendCommand("ProtoOAReconcileReq");
        const plainOpenPositions: GenericObject[] = accountOperativityStatus.position;
        let netProfit: number = 0;

        for (const plainOpenPosition of plainOpenPositions) {
            netProfit += await this.#getPlainPositionNetProfit(plainOpenPosition);
        }

        return await this.getBalance() + netProfit;
    }

    public override async getAssets (): Promise<MidaAsset[]> {
        const assets: MidaAsset[] = [];

        for (const plainAsset of [ ...this.#assets.values(), ]) {
            assets.push(new MidaAsset({
                id: plainAsset.id.toString(),
                name: plainAsset.name,
                description: "",
                measurementUnit: "",
            }));
        }

        return assets;
    }

    public override async getSymbols (): Promise<string[]> {
        const symbols: string[] = [];

        for (const plainSymbol of [ ...this.#symbols.values(), ]) {
            symbols.push(plainSymbol.symbolName);
        }

        return symbols;
    }


    public override async getSymbol (symbol: string): Promise<MidaSymbol | undefined> {
        const plainSymbol: GenericObject | undefined = this.#symbols.get(symbol);

        if (!plainSymbol) {
            return undefined;
        }

        const completePlainSymbol: GenericObject = await this.#getCompletePlainSymbol(symbol);
        const lotUnits = Number(completePlainSymbol.lotSize) / 100;

        return new MidaSymbol({
            symbol,
            brokerAccount: this,
            description: plainSymbol.description,
            type: MidaSymbolCategory.FOREX,
            digits: Number(completePlainSymbol.digits),
            leverage: -1, // Not supported
            minLots: Number(completePlainSymbol.minVolume) / 100 / lotUnits,
            maxLots: Number(completePlainSymbol.maxVolume) / 100 / lotUnits,
            lotUnits,
        });
    }

    public override async watchSymbolTicks (symbol: string): Promise<void> {
        const symbolDescriptor = this.#symbols.get(symbol);

        if (!symbolDescriptor) {
            return undefined;
        }

        const listenersCount: number = this.#tickListeners.get(symbol) ?? 0;

        this.#tickListeners.set(symbol, listenersCount + 1);

        if (listenersCount === 0) {
            await this.#sendCommand("ProtoOASubscribeSpotsReq", {
                symbolId: symbolDescriptor.symbolId,
                // subscribeToSpotTimestamp: true,
            });
        }
    }

    public override async getDeals (fromTimestamp?: number, toTimestamp?: number): Promise<MidaBrokerDeal[]> {
        await this.#preloadDeals(fromTimestamp ?? Date.now() - 1000 * 60 * 60 * 24, toTimestamp ?? Date.now());

        return [];
    }

    public override async getSymbolLastTick (symbol: string): Promise<MidaSymbolTick> {
        // Check if symbol ticks are already being listened
        if (this.#lastTicks.has(symbol)) {
            // Return the lastest tick
            return this.#lastTicks.get(symbol) as MidaSymbolTick;
        }

        const symbolDescriptor: GenericObject | undefined = this.#symbols.get(symbol);

        if (!symbolDescriptor) {
            throw new Error();
        }

        const uuid: string = MidaUtilities.generateUuid();

        return new Promise((resolve: any) => {
            this.#internalTickListeners.set(uuid, (tick: MidaSymbolTick) => {
                this.#internalTickListeners.delete(uuid);
                resolve(tick);
            });

            // Start litening for ticks, the first event contains always the latest known tick
            this.#sendCommand("ProtoOASubscribeSpotsReq", {
                symbolId: symbolDescriptor.symbolId,
                // subscribeToSpotTimestamp: true,
            });
        });
    }

    public override async getSymbolBid (symbol: string): Promise<number> {
        return (await this.getSymbolLastTick(symbol)).bid;
    }

    public override async getSymbolAsk (symbol: string): Promise<number> {
        return (await this.getSymbolLastTick(symbol)).ask;
    }

    public override async placeOrder (directives: MidaBrokerOrderDirectives): Promise<CTraderBrokerOrder> {
        const uuid: string = MidaUtilities.generateUuid();

        if (directives.purpose === MidaBrokerOrderPurpose.OPEN && !directives.positionId) {
            // const positionId: string = directives.positionId;
            const symbol: string = directives.symbol;
            const plainSymbol: GenericObject = this.#symbols.get(symbol) as GenericObject;

            await this.#sendCommand("ProtoOANewOrderReq", {
                symbolId: plainSymbol.symbolId,
                orderType: "MARKET",
                tradeSide: directives.direction === MidaBrokerOrderDirection.BUY ? "BUY" : "SELL",
                volume: directives.volume,
                label: uuid,
            });
        }

        // @ts-ignore
        return;
    }

    // eslint-disable-next-line max-lines-per-function
    public normalizeDeal (plainDeal: GenericObject): MidaBrokerDeal {
        const id = plainDeal.dealId.toString();
        const orderId = plainDeal.orderId.toString();
        const positionId = plainDeal.positionId.toString();
        const symbol = this.#getPlainSymbolById(plainDeal.symbolId.toString())?.symbolName;
        const requestedVolume = Number(plainDeal.volume) / 100;
        const filledVolume = Number(plainDeal.filledVolume) / 100;
        let direction: MidaBrokerDealDirection;

        switch (plainDeal.tradeSide) {
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

        switch (plainDeal.status) {
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

        const purpose: MidaBrokerDealPurpose = plainDeal.closePositionDetail ? MidaBrokerDealPurpose.CLOSE : MidaBrokerDealPurpose.OPEN;
        const requestDate = new MidaDate({ timestamp: Number(plainDeal.createTimestamp), });
        const executionDate = new MidaDate({ timestamp: Number(plainDeal.executionTimestamp), });
        const rejectionDate: MidaDate | undefined = undefined;
        const executionPrice: number = Number(plainDeal.executionPrice);
        const grossProfit: number | undefined = ((): number | undefined => {
            if (purpose === MidaBrokerDealPurpose.CLOSE) {
                return Number(plainDeal.closePositionDetail.grossProfit) / 100;
            }

            return undefined;
        })();
        const commission: number = Number(plainDeal.commission) / 100;
        const swap: number | undefined = ((): number | undefined => {
            if (purpose === MidaBrokerDealPurpose.CLOSE) {
                return Number(plainDeal.closePositionDetail.swap) / 100;
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
        return (await this.#sendCommand("ProtoOATraderReq")).trader;
    }

    async #preloadAssets (): Promise<void> {
        const assetsMap: Map<string, GenericObject> = this.#assets;
        const assets: GenericObject[] = (await this.#sendCommand("ProtoOAAssetListReq")).asset;

        assetsMap.clear();
        assets.forEach((asset: GenericObject): void => {
            assetsMap.set(asset.name, asset);
        });
    }

    async #preloadSymbols (): Promise<void> {
        const symbolsMap: Map<string, GenericObject> = this.#symbols;
        const symbols: GenericObject[] = (await this.#sendCommand("ProtoOASymbolsListReq")).symbol;

        symbolsMap.clear();
        symbols.forEach((symbol: GenericObject): void => {
            symbolsMap.set(symbol.symbolName, symbol);
        });
    }

    async #preloadDeals (fromTimestamp: number, toTimestamp: number): Promise<void> {
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
        const symbol: string = this.#getPlainSymbolById(descriptor.symbolId.toString())?.symbolName as string;
        const tick: MidaSymbolTick = new MidaSymbolTick({
            symbol,
            bid: Number(descriptor.bid) / 100 / 1000,
            ask: Number(descriptor.ask) / 100 / 1000,
            date: new MidaDate(),
        });

        this.#lastTicks.set(symbol, tick);
        [ ...this.#internalTickListeners.values(), ].forEach((listener: Function): unknown => listener(tick));

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
            if (descriptor.ctidTraderAccountId.toString() !== this.#cTraderBrokerAccountId) {
                return;
            }

            this.#onExecution(descriptor);
        });
        // </execution>

        this.#connection.on("ProtoOAOrderErrorEvent", (descriptor: GenericObject): void => {

        });

        // <ticks>
        this.#connection.on("ProtoOASpotEvent", (descriptor: GenericObject): void => {
            if (descriptor.ctidTraderAccountId.toString() !== this.#cTraderBrokerAccountId) {
                return;
            }

            this.#onTick(descriptor);
        });
        // </ticks>

        // <symbol-update>
        this.#connection.on("ProtoOASymbolChangedEvent", (descriptor: GenericObject): void => {
            if (descriptor.ctidTraderAccountId.toString() !== this.#cTraderBrokerAccountId) {
                return;
            }

            const symbolId: string = descriptor.symbolId.toString();
            const plainSymbol: GenericObject = this.#getPlainSymbolById(symbolId) as GenericObject;
            const symbol: string = plainSymbol.symbolName;

            this.#completeSymbols.delete(symbol);
        });
        // </symbol-update>

        // <position-update>
        this.#connection.on("ProtoOAMarginChangedEvent", (descriptor: GenericObject): void => {
            if (descriptor.ctidTraderAccountId.toString() !== this.#cTraderBrokerAccountId) {
                return;
            }

            const positionId: string = descriptor.positionId.toString();
        });
        // </position-update>
    }

    #getPlainSymbolById (id: string): GenericObject | undefined {
        for (const plainSymbol of [ ...this.#symbols.values(), ]) {
            if (plainSymbol.symbolId.toString() === id) {
                return plainSymbol;
            }
        }

        return undefined;
    }

    async #getCompletePlainSymbol (symbol: string): Promise<GenericObject> {
        const plainSymbol: GenericObject = this.#symbols.get(symbol) as GenericObject;
        let completePlainSymbol: GenericObject | undefined = this.#completeSymbols.get(symbol);

        if (!completePlainSymbol) {
            completePlainSymbol = (await this.#sendCommand("ProtoOASymbolByIdReq", {
                symbolId: plainSymbol.symbolId,
            })).symbol[0] as GenericObject;

            this.#completeSymbols.set(symbol, completePlainSymbol);
        }

        return completePlainSymbol;
    }

    #getPlainAssetById (id: string): GenericObject | undefined {
        return [ ...this.#assets.values(), ].find((asset: GenericObject) => asset.assetId.toString() === id);
    }

    #getPlainAssetByName (name: string): GenericObject | undefined {
        return [ ...this.#assets.values(), ].find((asset: GenericObject) => asset.name === name);
    }

    #getPlainOrderById (id: string): GenericObject | undefined {
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

    // eslint-disable-next-line max-lines-per-function
    async #getPlainPositionGrossProfit (plainPosition: GenericObject): Promise<number> {
        const plainSymbol: GenericObject | undefined = this.#getPlainSymbolById(plainPosition.tradeData.symbolId);
        const symbol: string = plainSymbol?.symbolName;

        if (!plainSymbol) {
            throw new Error();
        }

        let completePlainSymbol: GenericObject | undefined = this.#completeSymbols.get(symbol);

        if (!completePlainSymbol) {
            completePlainSymbol = (await this.#sendCommand("ProtoOASymbolByIdReq", {
                symbolId: plainSymbol.symbolId,
            })).symbol[0] as GenericObject;

            this.#completeSymbols.set(symbol, completePlainSymbol);
        }

        const lotUnits: number = Number(completePlainSymbol.lotSize) / 100;
        const volume: number = Number(plainPosition.tradeData.volume) / 100 / lotUnits;
        const openPrice: number = Number(plainPosition.price);
        const lastSymbolTick: MidaSymbolTick = await this.getSymbolLastTick(symbol);
        let direction: MidaBrokerPositionDirection;
        let closePrice: number;

        switch (plainPosition.tradeData.tradeSide.toUpperCase()) {
            case "SELL": {
                direction = MidaBrokerPositionDirection.SHORT;
                closePrice = lastSymbolTick.ask;

                break;
            }
            case "BUY": {
                direction = MidaBrokerPositionDirection.LONG;
                closePrice = lastSymbolTick.bid;

                break;
            }
            default: {
                throw new Error();
            }
        }

        let grossProfit: number;

        if (direction === MidaBrokerPositionDirection.LONG) {
            grossProfit = (closePrice - openPrice) * volume * lotUnits;
        }
        else {
            grossProfit = (openPrice - closePrice) * volume * lotUnits;
        }

        const quoteAssedId: string = plainSymbol.quoteAssetId.toString();
        const depositAssetId: string = (await this.#getPlainAssetByName(this.currencyIso))?.assetId.toString() as string;
        const depositConversionChain: GenericObject[] = (await this.#sendCommand("ProtoOASymbolsForConversionReq", {
            firstAssetId: quoteAssedId,
            lastAssetId: depositAssetId,
        })).symbol;
        let rate: number = 1;
        let movedAssetId: string = quoteAssedId;

        for (const plainLightSymbol of depositConversionChain) {
            const lastLightSymbolTick: MidaSymbolTick = await this.getSymbolLastTick(plainLightSymbol.symbolName);
            const supposedClosePrice: number = lastLightSymbolTick.ask;

            if (plainLightSymbol.baseAssetId.toString() === movedAssetId) {
                rate = rate * supposedClosePrice;
                movedAssetId = plainLightSymbol.quoteAssetId.toString();
            }
            else {
                rate = rate * (1 / supposedClosePrice);
                movedAssetId = plainLightSymbol.baseAssetId.toString();
            }
        }

        return grossProfit * rate;
    }

    async #getPlainPositionNetProfit (plainPosition: GenericObject): Promise<number> {
        const grossProfit: number = await this.#getPlainPositionGrossProfit(plainPosition);
        const totalCommission: number = Number(plainPosition.commission) / 100 * 2;
        const totalSwap: number = Number(plainPosition.swap) / 100;

        console.log(grossProfit);

        return grossProfit + totalCommission + totalSwap;
    }

    async #sendCommand (payloadType: string, parameters: GenericObject = {}): Promise<GenericObject> {
        return this.#connection.sendCommand(payloadType, {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
            ...parameters,
        });
    }
}
