import {
    GenericObject,
    MidaAsset,
    MidaBrokerAccount,
    MidaBrokerDeal,
    MidaBrokerDealDirection,
    MidaBrokerDealPurpose,
    MidaBrokerDealRejection,
    MidaBrokerDealStatus,
    MidaBrokerOrder,
    MidaBrokerOrderDirection,
    MidaBrokerOrderDirectives,
    MidaBrokerOrderPurpose,
    MidaBrokerOrderStatus,
    MidaBrokerOrderTimeInForce,
    MidaBrokerPositionDirection,
    MidaDate,
    MidaSymbol,
    MidaSymbolCategory,
    MidaSymbolPeriod,
    MidaSymbolPrice,
    MidaSymbolTick,
    MidaUtilities,
} from "@reiryoku/mida";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { CTraderBrokerAccountParameters } from "#brokers/ctrader/CTraderBrokerAccountParameters";
import { CTraderBrokerOrder } from "#brokers/ctrader/orders/CTraderBrokerOrder";
import { CTraderBrokerDeal } from "#brokers/ctrader/deals/CTraderBrokerDeal";
import { ORDER_SIGNATURE } from "!/src/core/CTraderPlugin";

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
    readonly #depositConversionChains: Map<string, GenericObject[]>;
    readonly #lastTicksPromises: Map<string, Promise<MidaSymbolTick>>;

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
        this.#depositConversionChains = new Map();
        this.#lastTicksPromises = new Map();

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
        // eslint-disable-next-line
        const unrealizedNetProfits: number[] = await Promise.all(plainOpenPositions.map((plainOpenPosition: GenericObject) => this.#getPlainPositionNetProfit(plainOpenPosition)));
        let equity: number = await this.getBalance();

        for (const unrealizedNetProfit of unrealizedNetProfits) {
            equity += unrealizedNetProfit;
        }

        return equity;
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

    public override async isSymbolMarketOpen (symbol: string): Promise<boolean> {
        throw new Error();
    }

    public override async logout (): Promise<void> {
        throw new Error();
    }

    public override async getSymbolPeriods (symbol: string, timeframe: number, price?: MidaSymbolPrice): Promise<MidaSymbolPeriod[]> {
        const periods: MidaSymbolPeriod[] = [];
        const plainSymbol: GenericObject = this.#symbols.get(symbol) as GenericObject;
        const symbolId: string = plainSymbol.symbolId.toString();
        const plainPeriods: GenericObject[] = (await this.#sendCommand("ProtoOAGetTrendbarsReq", {
            fromTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 5,
            toTimestamp: Date.now(),
            period: normalizeTimeframe(timeframe),
            symbolId,
            // count: 1000,
        })).trendbar;

        for (const plainPeriod of plainPeriods) {
            const low: number = Number(plainPeriod.low) / 100000;

            periods.push(new MidaSymbolPeriod({
                symbol,
                startDate: new MidaDate({ timestamp: Number(plainPeriod.utcTimestampInMinutes) * 1000 * 60, }),
                priceType: MidaSymbolPrice.BID,
                open: low + Number(plainPeriod.deltaOpen) / 100000,
                high: low + Number(plainPeriod.deltaHigh) / 100000,
                low,
                close: low + Number(plainPeriod.deltaClose) / 100000,
                volume: Number(plainPeriod.volume),
                timeframe,
            }));
        }

        return periods;
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
            leverage: -1, // @unsupported
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

        if (this.#lastTicksPromises.has(symbol)) {
            return this.#lastTicksPromises.get(symbol) as Promise<MidaSymbolTick>;
        }

        const symbolDescriptor: GenericObject | undefined = this.#symbols.get(symbol);

        if (!symbolDescriptor) {
            throw new Error();
        }

        const lastTickPromise: Promise<MidaSymbolTick> = new Promise((resolve: any) => {
            this.#internalTickListeners.set(symbol, (tick: MidaSymbolTick) => {
                this.#internalTickListeners.delete(symbol);
                this.#lastTicksPromises.delete(symbol);
                resolve(tick);
            });

            // Start litening for ticks, the first event always contains the latest known tick
            this.watchSymbolTicks(symbol);
        });

        this.#lastTicksPromises.set(symbol, lastTickPromise);

        return lastTickPromise;
    }

    public override async getOrderById (id: string): Promise<CTraderBrokerOrder | undefined> {
        const plainOrder: GenericObject | undefined = await this.#getPlainOrderById(id);

        if (!plainOrder) {
            return undefined;
        }

        // @ts-ignore
        return new MidaBrokerOrder();
    }

    public override async getDealById (id: string): Promise<CTraderBrokerDeal | undefined> {
        const plainDeal: GenericObject | undefined = await this.#getPlainDealById(id);

        if (!plainDeal) {
            return undefined;
        }

        return this.normalizePlainDeal(plainDeal);
    }

    public async normalizePlainOrder (plainOrder: GenericObject): Promise<CTraderBrokerOrder> {
        const tradeSide: string = plainOrder.tradeData.tradeSide;
        const symbol: string = this.#getPlainSymbolById(plainOrder.tradeData.symbolId)?.symbolName;
        const completePlainSymbol: GenericObject = await this.#getCompletePlainSymbol(symbol);
        const lotUnits: number = Number(completePlainSymbol.lotSize) / 100;
        const volume: number = Number(plainOrder.tradeData.volume) / 100 / lotUnits;
        const purpose: MidaBrokerOrderPurpose = plainOrder.closingOrder === false ? MidaBrokerOrderPurpose.OPEN : MidaBrokerOrderPurpose.CLOSE;
        const openDate: MidaDate = new MidaDate({ timestamp: Number(plainOrder.tradeData.openTimestamp), });
        const direction: MidaBrokerOrderDirection = tradeSide === "SELL" ? MidaBrokerOrderDirection.SELL : MidaBrokerOrderDirection.BUY;

        return new CTraderBrokerOrder({
            id: plainOrder.orderId.toString(),
            brokerAccount: this,
            symbol,
            requestedVolume: volume,
            direction,
            purpose,
            limit: undefined,
            stop: undefined,
            status: MidaBrokerOrderStatus.FILLED,
            creationDate: openDate,
            lastUpdateDate: openDate,
            timeInForce: MidaBrokerOrderTimeInForce.FILL_OR_KILL,
            isStopOut: false,
            uuid: plainOrder.tradeData.comment ?? "",
            connection: this.#connection,
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
        const order: CTraderBrokerOrder = new CTraderBrokerOrder({
            brokerAccount: this,
            symbol: "",
            requestedVolume: directives.volume as number,
            direction: MidaBrokerOrderDirection.BUY,
            purpose: directives.purpose,
            status: MidaBrokerOrderStatus.REQUESTED,
            timeInForce: MidaBrokerOrderTimeInForce.FILL_OR_KILL,
            uuid,
            connection: this.#connection,
        });

        if (directives.purpose === MidaBrokerOrderPurpose.OPEN) {
            const symbol: string | undefined = directives.symbol;
            const positionId: string | undefined = directives.positionId;

            if (symbol) {
                const plainSymbol: GenericObject = this.#symbols.get(symbol) as GenericObject;
                const completePlainSymbol: GenericObject = await this.#getCompletePlainSymbol(symbol);
                const lotUnits: number = Number(completePlainSymbol.lotSize) / 100;
                const normalizedVolume: number = directives.volume * lotUnits;

                await this.#sendCommand("ProtoOANewOrderReq", {
                    symbolId: plainSymbol.symbolId,
                    orderType: "MARKET",
                    tradeSide: directives.direction === MidaBrokerOrderDirection.BUY ? "BUY" : "SELL",
                    volume: normalizedVolume * 100, // Volume in cents
                    label: ORDER_SIGNATURE,
                }, uuid);
            }
            else if (positionId) {

            }
            else {
                throw new Error();
            }
        }
        else if (directives.purpose === MidaBrokerOrderPurpose.CLOSE) {

        }
        else {
            throw new Error();
        }

        return order;
    }

    // eslint-disable-next-line max-lines-per-function
    public normalizePlainDeal (plainDeal: GenericObject): CTraderBrokerDeal {
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
        let rejection: MidaBrokerDealRejection | undefined = undefined;

        switch (plainDeal.dealStatus) {
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
                rejection = MidaBrokerDealRejection.INTERNAL_BROKER_ERROR;

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

        return new CTraderBrokerDeal({
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

    // The first tick recived after subscription will always contain the latest known bid and ask price
    #onTick (descriptor: GenericObject): void {
        const symbol: string = this.#getPlainSymbolById(descriptor.symbolId.toString())?.symbolName as string;
        const bid: number = Number(descriptor.bid) / 100000;
        const ask: number = Number(descriptor.ask) / 100000;
        const isFirstTick: boolean = !this.#lastTicks.has(symbol);
        const previousTick: MidaSymbolTick | undefined = this.#lastTicks.get(symbol);
        const tick: MidaSymbolTick = new MidaSymbolTick({
            symbol,
            bid: bid !== 0 ? bid : previousTick?.bid,
            ask: ask !== 0 ? ask : previousTick?.ask,
            date: new MidaDate(),
        });

        this.#lastTicks.set(symbol, tick);
        this.#internalTickListeners.get(symbol)?.(tick);

        if (this.#tickListeners.has(symbol) && !isFirstTick) {
            this.notifyListeners("tick", { tick, });
        }
    }

    #onExecution (descriptor: GenericObject): void {
        console.log(descriptor);
    }

    // eslint-disable-next-line max-lines-per-function
    #configureListeners (): void {
        // <execution>
        this.#connection.on("ProtoOAExecutionEvent", (descriptor: GenericObject): void => {
            if (descriptor.ctidTraderAccountId.toString() !== this.#cTraderBrokerAccountId) {
                return;
            }

            try {
                this.#onExecution(descriptor);
            }
            catch (error) {
                console.log(error);
            }
        });
        // </execution>

        // <ticks>
        this.#connection.on("ProtoOASpotEvent", (descriptor: GenericObject): void => {
            if (descriptor.ctidTraderAccountId.toString() !== this.#cTraderBrokerAccountId) {
                return;
            }

            try {
                this.#onTick(descriptor);
            }
            catch (error) {
                console.log(error);
            }
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

        const completePlainSymbol: GenericObject = await this.#getCompletePlainSymbol(symbol);
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
        let depositConversionChain: GenericObject[] | undefined = this.#depositConversionChains.get(symbol);
        let rate: number = 1;
        let movedAssetId: string = quoteAssedId;

        if (!depositConversionChain) {
            depositConversionChain = (await this.#sendCommand("ProtoOASymbolsForConversionReq", {
                firstAssetId: quoteAssedId,
                lastAssetId: depositAssetId,
            })).symbol as GenericObject[];

            this.#depositConversionChains.set(symbol, depositConversionChain);
        }

        // @ts-ignore
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

        console.log(grossProfit + totalCommission + totalSwap);

        return grossProfit + totalCommission + totalSwap;
    }

    async #getPlainOrderById (id: string): Promise<GenericObject | undefined> {
        if (this.#orders.has(id)) {
            return this.#orders.get(id);
        }

        const W1: number = 604800000; // max. 1 week as indicated at https://spotware.github.io/open-api-docs/messages/#protooaorderlistreq
        let toTimestamp: number = Date.now();
        let fromTimestamp: number = toTimestamp - W1;
        let totalTimestamp: number = W1;

        while (totalTimestamp / W1 <= 3) {
            const plainOrders: GenericObject[] = (await this.#sendCommand("ProtoOAOrderListReq", {
                fromTimestamp,
                toTimestamp,
            })).order;

            if (plainOrders.length === 0) {
                return undefined;
            }

            for (const plainOrder of plainOrders) {
                const orderId: string = Number(plainOrder.orderId).toString();

                if (!this.#orders.has(orderId)) {
                    this.#orders.set(orderId, plainOrder);
                }
            }

            if (this.#orders.has(id)) {
                return this.#orders.get(id);
            }

            toTimestamp = fromTimestamp;
            fromTimestamp -= W1;
            totalTimestamp += W1;
        }

        return undefined;
    }

    async #getPlainDealById (id: string): Promise<GenericObject | undefined> {
        if (this.#deals.has(id)) {
            return this.#deals.get(id);
        }

        const W1: number = 604800000; // max. 1 week as indicated at https://spotware.github.io/open-api-docs/messages/#protooadeallistreq
        let toTimestamp: number = Date.now();
        let fromTimestamp: number = toTimestamp - W1;
        let totalTimestamp: number = W1;

        while (totalTimestamp / W1 <= 3) {
            const plainDeals: GenericObject[] = (await this.#sendCommand("ProtoOADealListReq", {
                fromTimestamp,
                toTimestamp,
            })).deal;

            if (plainDeals.length === 0) {
                return undefined;
            }

            for (const plainDeal of plainDeals) {
                const dealId: string = Number(plainDeal.dealId).toString();

                if (!this.#deals.has(dealId)) {
                    this.#deals.set(dealId, plainDeal);
                }
            }

            if (this.#deals.has(id)) {
                return this.#deals.get(id);
            }

            toTimestamp = fromTimestamp;
            fromTimestamp -= W1;
            totalTimestamp += W1;
        }

        return undefined;
    }

    async #sendCommand (payloadType: string, parameters?: GenericObject, messageId?: string): Promise<GenericObject> {
        return this.#connection.sendCommand(payloadType, {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
            ...parameters ?? {},
        }, messageId);
    }

    async #trySendCommand (payloadType: string, parameters?: GenericObject, messageId?: string): Promise<GenericObject | undefined> {
        return this.#connection.trySendCommand(payloadType, {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
            ...parameters ?? {},
        }, messageId);
    }
}

export function normalizeTimeframe (timeframe: number): string {
    switch (timeframe) {
        case 60: {
            return "M1";
        }
        case 120: {
            return "M2";
        }
        case 180: {
            return "M3";
        }
        case 240: {
            return "M4";
        }
        case 300: {
            return "M5";
        }
        default: {
            throw new Error();
        }
    }
}
