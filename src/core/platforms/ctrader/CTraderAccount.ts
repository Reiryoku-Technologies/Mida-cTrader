import {
    GenericObject,
    MidaAsset,
    MidaAssetStatement,
    MidaDate, MidaEmitter,
    MidaEventListener,
    MidaOrder,
    MidaOrderDirection,
    MidaOrderDirectives,
    MidaOrderPurpose,
    MidaOrderStatus,
    MidaOrderTimeInForce,
    MidaPeriod,
    MidaPosition,
    MidaPositionDirection,
    MidaProtection,
    MidaQuotationPrice,
    MidaSymbol,
    MidaTick,
    MidaTickMovement,
    MidaTimeframe,
    MidaTrade,
    MidaTradeDirection,
    MidaTradePurpose,
    MidaTradeRejection,
    MidaTradeStatus,
    MidaTradingAccount,
    MidaUnsupportedOperationError,
    MidaUtilities,
} from "@reiryoku/mida";
import { CTraderConnection, } from "@reiryoku/ctrader-layer";
import { CTraderAccountParameters, } from "#platforms/ctrader/CTraderAccountParameters";
import { CTraderOrder, } from "#platforms/ctrader/orders/CTraderOrder";
import { CTraderTrade, } from "#platforms/ctrader/trades/CTraderTrade";
import { CTraderPosition, } from "#platforms/ctrader/positions/CTraderPosition";

export class CTraderAccount extends MidaTradingAccount {
    readonly #connection: CTraderConnection;
    readonly #cTraderEmitter: MidaEmitter;
    readonly #brokerAccountId: string;
    readonly #brokerName: string;
    readonly #assets: Map<string, GenericObject>;
    readonly #normalizedAssets: Map<string, MidaAsset>;
    readonly #symbols: Map<string, GenericObject>;
    readonly #normalizedSymbols: Map<string, MidaSymbol>;
    readonly #completeSymbols: Map<string, GenericObject>;
    readonly #symbolsCategories: Map<string, GenericObject>;
    readonly #tickListeners: Map<string, number>;
    readonly #plainOrders: Map<string, GenericObject>;
    readonly #normalizedOrders: Map<string, CTraderOrder>;
    readonly #plainTrades: Map<string, GenericObject>;
    readonly #normalizedTrades: Map<string, CTraderTrade>;
    readonly #plainPositions: Map<string, GenericObject>;
    readonly #normalizedPositions: Map<string, CTraderPosition>;
    readonly #lastTicks: Map<string, MidaTick>;
    readonly #internalTickListeners: Map<string, Function>;
    readonly #depositConversionChains: Map<string, GenericObject[]>;
    readonly #lastTicksPromises: Map<string, Promise<MidaTick>>;
    readonly #updateEventQueue: GenericObject[];
    #updateEventIsLocked: boolean;

    public constructor ({
        id,
        platform,
        creationDate,
        ownerName,
        primaryAsset,
        operativity,
        positionAccounting,
        indicativeLeverage,
        connection,
        brokerAccountId,
        brokerName,
    }: CTraderAccountParameters) {
        super({
            id,
            platform,
            creationDate,
            ownerName,
            primaryAsset,
            operativity,
            positionAccounting,
            indicativeLeverage,
        });

        this.#connection = connection;
        this.#cTraderEmitter = new MidaEmitter();
        this.#brokerAccountId = brokerAccountId;
        this.#brokerName = brokerName;
        this.#assets = new Map();
        this.#normalizedAssets = new Map();
        this.#symbols = new Map();
        this.#normalizedSymbols = new Map();
        this.#completeSymbols = new Map();
        this.#symbolsCategories = new Map();
        this.#tickListeners = new Map();
        this.#plainOrders = new Map();
        this.#normalizedOrders = new Map();
        this.#plainTrades = new Map();
        this.#normalizedTrades = new Map();
        this.#plainPositions = new Map();
        this.#normalizedPositions = new Map();
        this.#lastTicks = new Map();
        this.#internalTickListeners = new Map();
        this.#depositConversionChains = new Map();
        this.#lastTicksPromises = new Map();
        this.#updateEventQueue = [];
        this.#updateEventIsLocked = false;

        this.#configureListeners();
    }

    public get brokerAccountId (): string {
        return this.#brokerAccountId;
    }

    public get brokerName (): string {
        return this.#brokerName;
    }

    public get plainOpenPositions (): GenericObject[] {
        const plainOpenPositions: GenericObject[] = [];

        for (const plainPosition of [ ...this.#plainPositions.values(), ]) {
            if (plainPosition.positionStatus === "POSITION_STATUS_OPEN") {
                plainOpenPositions.push(plainPosition);
            }
        }

        return plainOpenPositions;
    }

    public async preloadAssetsAndSymbols (): Promise<void> {
        await Promise.all([ this.#preloadAssets(), this.#preloadSymbols(), ]);
    }

    public async preload (): Promise<void> {
        await Promise.all([ this.preloadAssetsAndSymbols(), this.#preloadOpenPositions(), ]);
    }

    public override async getBalance (): Promise<number> {
        const accountDescriptor: GenericObject = await this.#getAccountDescriptor();

        return Number(accountDescriptor.balance.toString()) / 100;
    }

    public override async getBalanceSheet (): Promise<MidaAssetStatement[]> {
        if (await this.getBalance() > 0) {
            return [ await this.getAssetBalance(this.primaryAsset), ];
        }

        return [];
    }

    public override async getUsedMargin (): Promise<number> {
        let usedMargin: number = 0;

        for (const plainOpenPosition of this.plainOpenPositions) {
            usedMargin += Number(plainOpenPosition.usedMargin);
        }

        return usedMargin / 100;
    }

    public override async getEquity (): Promise<number> {
        const unrealizedNetProfits: number[] = await Promise.all(
            this.plainOpenPositions.map((plainOpenPosition: GenericObject) => this.getPlainPositionNetProfit(plainOpenPosition))
        );
        let equity: number = await this.getBalance();

        for (const unrealizedNetProfit of unrealizedNetProfits) {
            equity += unrealizedNetProfit;
        }

        return equity;
    }

    public override async getAssets (): Promise<string[]> {
        return [ ...this.#normalizedAssets.keys(), ];
    }

    public override async isSymbolMarketOpen (symbol: string): Promise<boolean> {
        const completeSymbol: GenericObject = await this.#getCompletePlainSymbol(symbol);
        const schedules: GenericObject[] = completeSymbol.schedule;
        const actualDate: Date = new Date();
        const actualTimestamp: number = actualDate.getTime();
        const lastSundayTimestamp: number = getLastSunday(actualDate).getTime();

        for (const schedule of schedules) {
            if (
                actualTimestamp >= (lastSundayTimestamp + schedule.startSecond * 1000) &&
                actualTimestamp <= (lastSundayTimestamp + schedule.endSecond * 1000)
            ) {
                return true;
            }
        }

        return false;
    }

    public override async getSymbolPeriods (symbol: string, timeframe: number): Promise<MidaPeriod[]> {
        const periods: MidaPeriod[] = [];
        const plainSymbol: GenericObject = this.#symbols.get(symbol) as GenericObject;
        const symbolId: string = plainSymbol.symbolId.toString();
        const plainPeriods: GenericObject[] = (await this.#sendCommand("ProtoOAGetTrendbarsReq", {
            fromTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 5,
            toTimestamp: Date.now(),
            period: toCTraderTimeframe(timeframe),
            symbolId,
            count: 500,
        })).trendbar;

        for (const plainPeriod of plainPeriods) {
            const low: number = Number(plainPeriod.low) / 100000;

            periods.push(new MidaPeriod({
                symbol,
                startDate: new MidaDate(Number(plainPeriod.utcTimestampInMinutes) * 1000 * 60),
                quotationPrice: MidaQuotationPrice.BID,
                open: low + Number(plainPeriod.deltaOpen) / 100000,
                high: low + Number(plainPeriod.deltaHigh) / 100000,
                low,
                close: low + Number(plainPeriod.deltaClose) / 100000,
                volume: Number(plainPeriod.volume),
                timeframe,
            }));
        }

        // Order from oldest to newest
        periods.sort((left, right): number => left.startDate.timestamp - right.startDate.timestamp);

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
        const C100: number = 100; // Divider for cents
        const plainSymbol: GenericObject | undefined = this.#symbols.get(symbol);

        if (!plainSymbol) {
            return undefined;
        }

        let normalizedSymbol: MidaSymbol | undefined = this.#normalizedSymbols.get(symbol);

        if (normalizedSymbol) {
            return normalizedSymbol;
        }

        const completePlainSymbol: GenericObject = await this.#getCompletePlainSymbol(symbol);
        const lotUnits = Number(completePlainSymbol.lotSize) / C100;
        normalizedSymbol = new MidaSymbol({
            symbol,
            tradingAccount: this,
            description: plainSymbol.description,
            baseAsset: this.getAssetById(plainSymbol.baseAssetId)?.toString() as string,
            quoteAsset: this.getAssetById(plainSymbol.quoteAssetId)?.toString() as string,
            leverage: -1, // TODO => Add leverage
            minLots: Number(completePlainSymbol.minVolume) / lotUnits / C100,
            maxLots: Number(completePlainSymbol.maxVolume) / lotUnits / C100,
            lotUnits,
        });

        this.#normalizedSymbols.set(symbol, normalizedSymbol);

        return normalizedSymbol;
    }

    public override async getAsset (asset: string): Promise<MidaAsset | undefined> {
        return this.#normalizedAssets.get(asset);
    }

    public override async getAssetBalance (asset: string): Promise<MidaAssetStatement> {
        if (asset === this.primaryAsset) {
            return {
                tradingAccount: this,
                date: new MidaDate(),
                asset,
                freeVolume: await this.getFreeMargin(),
                lockedVolume: await this.getUsedMargin(),
                borrowedVolume: 0,
            };
        }

        return {
            tradingAccount: this,
            date: new MidaDate(),
            asset,
            freeVolume: 0,
            lockedVolume: 0,
            borrowedVolume: 0,
        };
    }

    public override async getCryptoAssetDepositAddress (asset: string, net: string): Promise<string> {
        throw new MidaUnsupportedOperationError();
    }

    public override async watchSymbolTicks (symbol: string): Promise<void> {
        const symbolDescriptor: GenericObject | undefined = this.#symbols.get(symbol);

        if (!symbolDescriptor) {
            return;
        }

        const listenersCount: number = this.#tickListeners.get(symbol) ?? 0;

        this.#tickListeners.set(symbol, listenersCount + 1);

        if (listenersCount === 0) {
            await this.#sendCommand("ProtoOASubscribeSpotsReq", {
                symbolId: symbolDescriptor.symbolId,
                subscribeToSpotTimestamp: true,
            });
        }
    }

    public override async getOrders (symbol: string): Promise<MidaOrder[]> {
        const normalizedFromTimestamp: number = Date.now() - 1000 * 60 * 60 * 24 * 3;
        const normalizedToTimestamp: number = Date.now();
        const ordersPromises: Promise<MidaOrder>[] = [];
        const plainOrders: GenericObject[] = await this.#getPlainOrders(normalizedFromTimestamp, normalizedToTimestamp);

        for (const plainOrder of plainOrders) {
            if (
                Number(plainOrder.tradeData.openTimestamp) >= normalizedFromTimestamp
                && Number(plainOrder.tradeData.openTimestamp) <= normalizedToTimestamp
            ) {
                ordersPromises.push(this.normalizeOrder(plainOrder));
            }
        }

        return (await Promise.all(ordersPromises)).filter((order: MidaOrder): boolean => order.symbol === symbol);
    }

    public override async getPendingOrders (): Promise<MidaOrder[]> {
        const pendingOrdersPromises: Promise<MidaOrder>[] = [];

        for (const plainOrder of [ ...this.#plainOrders.values(), ]) {
            if (plainOrder.orderStatus === "ORDER_STATUS_ACCEPTED" && plainOrder.orderType.toUpperCase() !== "MARKET") {
                pendingOrdersPromises.push(this.normalizeOrder(plainOrder));
            }
        }

        return Promise.all(pendingOrdersPromises);
    }

    public override async getTrades (symbol: string): Promise<MidaTrade[]> {
        const normalizedFromTimestamp: number = Date.now() - 1000 * 60 * 60 * 24 * 3;
        const normalizedToTimestamp: number = Date.now();
        const dealsPromises: Promise<MidaTrade>[] = [];

        await this.#preloadDeals(normalizedFromTimestamp, normalizedToTimestamp);

        for (const plainDeal of [ ...this.#plainOrders.values(), ]) {
            if (plainDeal.creationDate.timestamp >= normalizedFromTimestamp && plainDeal.creationDate.timestamp <= normalizedToTimestamp) {
                dealsPromises.push(this.normalizeTrade(plainDeal));
            }
        }

        return (await Promise.all(dealsPromises)).filter((deal: MidaTrade): boolean => deal.symbol === symbol);
    }

    async #getSymbolLastTick (symbol: string): Promise<MidaTick> {
        // Check if symbol ticks are already being listened
        if (this.#lastTicks.has(symbol)) {
            // Return the lastest tick
            return this.#lastTicks.get(symbol) as MidaTick;
        }

        if (this.#lastTicksPromises.has(symbol)) {
            return this.#lastTicksPromises.get(symbol) as Promise<MidaTick>;
        }

        const symbolDescriptor: GenericObject | undefined = this.#symbols.get(symbol);

        if (!symbolDescriptor) {
            throw new Error();
        }

        const lastTickPromise: Promise<MidaTick> = new Promise((resolve: any) => {
            this.#internalTickListeners.set(symbol, (tick: MidaTick) => {
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

    async #getOrderById (id: string): Promise<CTraderOrder | undefined> {
        const plainOrder: GenericObject | undefined = await this.getPlainOrderById(id);

        if (!plainOrder) {
            return undefined;
        }

        return this.normalizeOrder(plainOrder);
    }

    async #getDealById (id: string): Promise<CTraderTrade | undefined> {
        const plainDeal: GenericObject | undefined = await this.getPlainDealById(id);

        if (!plainDeal) {
            return undefined;
        }

        return this.normalizeTrade(plainDeal);
    }

    public override async getOpenPositions (): Promise<MidaPosition[]> {
        return Promise.all(this.plainOpenPositions.map(
            (plainPosition: GenericObject) => this.normalizePosition(plainPosition))
        ) as Promise<MidaPosition[]>;
    }

    // eslint-disable-next-line max-lines-per-function
    public async normalizeOrder (plainOrder: GenericObject): Promise<CTraderOrder> {
        const orderId: string = plainOrder.orderId.toString();
        let order: CTraderOrder | undefined = this.#normalizedOrders.get(orderId);

        if (order) {
            return order;
        }

        const tradeSide: string = plainOrder.tradeData.tradeSide;
        const symbol: string = this.#getPlainSymbolById(plainOrder.tradeData.symbolId)?.symbolName;
        const completePlainSymbol: GenericObject = await this.#getCompletePlainSymbol(symbol);
        const lotUnits: number = Number(completePlainSymbol.lotSize) / 100;
        const volume: number = Number(plainOrder.tradeData.volume) / 100 / lotUnits;
        const purpose: MidaOrderPurpose = plainOrder.closingOrder === false ? MidaOrderPurpose.OPEN : MidaOrderPurpose.CLOSE;
        const openDate: MidaDate = new MidaDate(Number(plainOrder.tradeData.openTimestamp));
        const direction: MidaOrderDirection = tradeSide === "SELL" ? MidaOrderDirection.SELL : MidaOrderDirection.BUY;
        const limitPrice: number = Number(plainOrder.limitPrice);
        const stopPrice: number = Number(plainOrder.stopPrice);
        let status: MidaOrderStatus;

        switch (plainOrder.orderStatus) {
            case "ORDER_STATUS_ACCEPTED": {
                if (plainOrder.orderType.toUpperCase() !== "MARKET") {
                    status = MidaOrderStatus.PENDING;
                }
                else {
                    status = MidaOrderStatus.ACCEPTED;
                }

                break;
            }
            case "ORDER_STATUS_FILLED": {
                status = MidaOrderStatus.EXECUTED;

                break;
            }
            case "ORDER_STATUS_REJECTED": {
                status = MidaOrderStatus.REJECTED;

                break;
            }
            case "ORDER_STATUS_EXPIRED": {
                status = MidaOrderStatus.EXPIRED;

                break;
            }
            case "ORDER_STATUS_CANCELLED": {
                status = MidaOrderStatus.CANCELLED;

                break;
            }
            default: {
                status = MidaOrderStatus.REQUESTED;
            }
        }

        order = new CTraderOrder({
            id: orderId,
            positionId: plainOrder.positionId.toString(),
            tradingAccount: this,
            symbol,
            requestedVolume: volume,
            direction,
            purpose,
            limitPrice: Number.isFinite(limitPrice) && limitPrice !== 0 ? limitPrice : undefined,
            stopPrice: Number.isFinite(stopPrice) && stopPrice !== 0 ? stopPrice : undefined,
            status,
            creationDate: openDate,
            lastUpdateDate: new MidaDate(Number(plainOrder.utcLastUpdateTimestamp)),
            timeInForce: MidaOrderTimeInForce.FILL_OR_KILL,
            trades: await this.getDealsByOrderId(orderId),
            rejection: undefined, // cTrader doesn't provide rejected or expired orders therefore normalized orders will always be executed
            isStopOut: plainOrder.isStopOut === true,
            uuid: plainOrder.clientOrderId || undefined,
            connection: this.#connection,
            cTraderEmitter: this.#cTraderEmitter,
        });

        this.#normalizedOrders.set(orderId, order);

        return order;
    }

    public async getDealsByOrderId (id: string): Promise<MidaTrade[]> {
        const timestamp: number = Date.now();

        await this.#preloadDeals(timestamp - 604800000, timestamp);

        const plainDeals: GenericObject[] = this.#getDealsDescriptorsByOrderId(id);
        const orderDealsPromises: Promise<CTraderTrade>[] = [];

        for (const plainDeal of plainDeals) {
            orderDealsPromises.push(this.normalizeTrade(plainDeal));
        }

        return Promise.all(orderDealsPromises);
    }

    public async normalizePosition (plainPosition: GenericObject): Promise<CTraderPosition | undefined> {
        const symbol: string = this.#getPlainSymbolById(plainPosition.tradeData.symbolId.toString())?.symbolName;
        const completePlainSymbol: GenericObject = await this.#getCompletePlainSymbol(symbol);
        const lotUnits: number = Number(completePlainSymbol.lotSize) / 100;
        const volume = Number(plainPosition.tradeData.volume) / lotUnits / 100;

        return new CTraderPosition({
            id: plainPosition.positionId.toString(),
            tradingAccount: this,
            volume,
            symbol,
            protection: this.normalizeProtection({
                takeProfit: plainPosition.takeProfit,
                stopLoss: plainPosition.stopLoss,
                trailingStopLoss: plainPosition.trailingStopLoss === true,
            }),
            direction: plainPosition.tradeData.tradeSide === "BUY" ? MidaPositionDirection.LONG : MidaPositionDirection.SHORT,
            connection: this.#connection,
            cTraderEmitter: this.#cTraderEmitter,
        });
    }

    public override async getSymbolBid (symbol: string): Promise<number> {
        return (await this.#getSymbolLastTick(symbol)).bid;
    }

    public override async getSymbolAsk (symbol: string): Promise<number> {
        return (await this.#getSymbolLastTick(symbol)).ask;
    }

    public override async getSymbolAveragePrice (symbol: string): Promise<number> {
        const { bid, ask, } = await this.#getSymbolLastTick(symbol);

        return (bid + ask) / 2;
    }

    // eslint-disable-next-line max-lines-per-function, complexity
    public override async placeOrder (directives: MidaOrderDirectives): Promise<CTraderOrder> {
        const uuid: string = MidaUtilities.uuid();
        const positionId: string | undefined = directives.positionId;
        let symbol: string | undefined = undefined;
        let requestedVolume: number = directives.volume as number;
        let existingPosition: CTraderPosition | undefined = undefined;
        let purpose: MidaOrderPurpose;
        let limitPrice: number | undefined = undefined;
        let stopPrice: number | undefined = undefined;
        let requestDirectives: GenericObject = {};

        // Check if order is related to an existing position
        if (positionId && !directives.symbol) {
            const plainPosition: GenericObject = this.#plainPositions.get(positionId) as GenericObject;
            existingPosition = await this.normalizePosition(plainPosition) as CTraderPosition;
            symbol = existingPosition.symbol;

            if (!Number.isFinite(requestedVolume)) {
                requestedVolume = existingPosition.volume;
            }

            if (
                (existingPosition.direction === MidaPositionDirection.LONG && directives.direction === MidaOrderDirection.BUY)
                || (existingPosition.direction === MidaPositionDirection.SHORT && directives.direction === MidaOrderDirection.SELL)
            ) {
                purpose = MidaOrderPurpose.OPEN;
            }
            else {
                purpose = MidaOrderPurpose.CLOSE;
            }
        }
        else if (directives.symbol && !positionId) {
            purpose = MidaOrderPurpose.OPEN;
            symbol = directives.symbol;
            limitPrice = directives.limit;
            stopPrice = directives.stop;
        }
        else {
            throw new Error();
        }

        const order: CTraderOrder = new CTraderOrder({
            id: "",
            tradingAccount: this,
            symbol,
            requestedVolume,
            direction: directives.direction,
            purpose,
            limitPrice,
            stopPrice,
            status: MidaOrderStatus.REQUESTED,
            creationDate: undefined,
            lastUpdateDate: undefined,
            timeInForce: MidaOrderTimeInForce.IMMEDIATE_OR_CANCEL,
            trades: [],
            rejection: undefined,
            isStopOut: false, // Stop out orders are sent by broker
            uuid,
            connection: this.#connection,
            cTraderEmitter: this.#cTraderEmitter,
            requestedProtection: directives.protection,
        });

        const plainSymbol: GenericObject = this.#symbols.get(symbol) as GenericObject;
        const completePlainSymbol: GenericObject = await this.#getCompletePlainSymbol(symbol);
        const lotUnits: number = Number(completePlainSymbol.lotSize) / 100;
        const normalizedVolume: number = requestedVolume * lotUnits * 100;
        let setProtectionAfterExecution: boolean = false;

        requestDirectives = {
            symbolId: plainSymbol.symbolId.toString(),
            volume: normalizedVolume,
            tradeSide: directives.direction === MidaOrderDirection.BUY ? "BUY" : "SELL",
            label: "Mida cTrader",
        };

        if (!existingPosition) {
            const {
                stopLoss,
                takeProfit,
                trailingStopLoss,
            } = directives.protection ?? {};

            if (Number.isFinite(limitPrice)) {
                requestDirectives.orderType = "LIMIT";
                requestDirectives.limitPrice = limitPrice;
            }
            else if (Number.isFinite(stopPrice)) {
                requestDirectives.orderType = "STOP";
                requestDirectives.stopPrice = stopPrice;
            }
            else {
                requestDirectives.orderType = "MARKET";
            }

            // cTrader Open API doesn't allow using absolute protection on market orders
            if (requestDirectives.orderType !== "MARKET") {
                if (Number.isFinite(stopLoss)) {
                    requestDirectives.stopLoss = stopLoss;
                }

                if (Number.isFinite(takeProfit)) {
                    requestDirectives.takeProfit = takeProfit;
                }

                if (trailingStopLoss) {
                    requestDirectives.trailingStopLoss = true;
                }
            }
            else {
                setProtectionAfterExecution = true;
            }
        }
        else {
            requestDirectives.positionId = positionId;
            requestDirectives.orderType = "MARKET";

            if (directives.protection) {
                console.log("Order protection ignored, change the protection directly on the position");
            }
        }

        const resolverEvents: string[] = directives.resolverEvents ?? [
            "reject",
            "pending",
            "cancel",
            "expire",
            "execute",
        ];
        const resolver: Promise<CTraderOrder> = new Promise((resolve: (order: CTraderOrder) => void) => {
            if (resolverEvents.length === 0) {
                resolve(order);
            }
            else {
                const resolverEventsUuids: Map<string, string> = new Map();

                for (const eventType of resolverEvents) {
                    resolverEventsUuids.set(eventType, order.on(eventType, (): void => {
                        for (const uuid of [ ...resolverEventsUuids.values(), ]) {
                            order.removeEventListener(uuid);
                        }

                        resolve(order);
                    }));
                }
            }
        });

        const listeners: { [eventType: string]: MidaEventListener } = directives.listeners ?? {};

        for (const eventType of Object.keys(listeners)) {
            order.on(eventType, listeners[eventType]);
        }

        const normalizeEventUuid: string = order.on("*", () => {
            const id: string | undefined = order.id;

            if (id) {
                order.removeEventListener(normalizeEventUuid);
                this.#normalizedOrders.set(id, order);
            }
        });

        // <set-protection-after-execution>
        if (setProtectionAfterExecution) {
            order.on("execute", async (): Promise<void> => {
                const protection = directives.protection;
                const openPosition: MidaPosition | undefined = (await this.getOpenPositions())
                    .find((position: MidaPosition) => position.id === order.positionId);

                if (openPosition && protection) {
                    await openPosition.changeProtection(protection);
                }
            });
        }
        // </set-protection-after-execution>

        this.#sendCommand("ProtoOANewOrderReq", requestDirectives, uuid);

        return resolver;
    }

    /** Used to convert a cTrader server deal (trade) to a Mida trade */
    // eslint-disable-next-line max-lines-per-function
    public async normalizeTrade (plainDeal: GenericObject): Promise<CTraderTrade> {
        const id = plainDeal.dealId.toString();
        const orderId = plainDeal.orderId.toString();
        const symbol: string = this.#getPlainSymbolById(plainDeal.symbolId.toString())?.symbolName;
        const completePlainSymbol: GenericObject = await this.#getCompletePlainSymbol(symbol);
        const lotUnits: number = Number(completePlainSymbol.lotSize) / 100;
        const filledVolume = Number(plainDeal.filledVolume) / lotUnits / 100;
        let direction: MidaTradeDirection;

        switch (plainDeal.tradeSide.toUpperCase()) {
            case "SELL": {
                direction = MidaTradeDirection.SELL;

                break;
            }
            case "BUY": {
                direction = MidaTradeDirection.BUY;

                break;
            }
            default: {
                throw new Error();
            }
        }

        let status: MidaTradeStatus;
        let rejection: MidaTradeRejection | undefined = undefined;

        switch (plainDeal.dealStatus) {
            case "PARTIALLY_FILLED":
            case "FILLED": {
                status = MidaTradeStatus.EXECUTED;

                break;
            }
            case "MISSED": {
                status = MidaTradeStatus.REJECTED;
                rejection = MidaTradeRejection.MISSED;

                break;
            }
            case "REJECTED": {
                status = MidaTradeStatus.REJECTED;
                rejection = MidaTradeRejection.NO_LIQUIDITY;

                break;
            }
            case "ERROR":
            case "INTERNALLY_REJECTED": {
                status = MidaTradeStatus.REJECTED;
                rejection = MidaTradeRejection.UNKNOWN;

                break;
            }
            default: {
                throw new Error();
            }
        }

        const purpose: MidaTradePurpose = plainDeal.closePositionDetail ? MidaTradePurpose.CLOSE : MidaTradePurpose.OPEN;
        const executionDate = new MidaDate(Number(plainDeal.executionTimestamp));
        const rejectionDate: MidaDate | undefined = undefined;
        const executionPrice: number = Number(plainDeal.executionPrice);
        const grossProfit: number = Number(plainDeal?.closePositionDetail?.grossProfit) / 100;
        const commission: number = Number(plainDeal.commission) / 100;
        const swap: number = Number(plainDeal?.closePositionDetail?.swap) / 100;

        return new CTraderTrade({
            id,
            orderId,
            positionId: plainDeal.positionId.toString(),
            volume: filledVolume,
            direction,
            status,
            purpose,
            executionDate,
            rejectionDate,
            executionPrice: Number.isFinite(executionPrice) ? executionPrice : undefined,
            grossProfit: Number.isFinite(grossProfit) ? grossProfit : undefined,
            commission: Number.isFinite(commission) ? commission : undefined,
            commissionAsset: this.primaryAsset,
            swap: Number.isFinite(swap) ? swap : undefined,
            grossProfitAsset: this.primaryAsset,
            swapAsset: this.primaryAsset,
            symbol,
            rejection,
            tradingAccount: this,
        });
    }

    public getAssetById (id: string): MidaAsset | undefined {
        const plainAsset: GenericObject | undefined = this.#getPlainAssetById(id);

        if (!plainAsset) {
            return undefined;
        }

        return this.#normalizedAssets.get(plainAsset.name);
    }

    // eslint-disable-next-line id-length
    public normalizeProtection (plainPosition: GenericObject): MidaProtection {
        const takeProfit: number = Number(plainPosition.takeProfit);
        const stopLoss: number = Number(plainPosition.stopLoss);
        const trailingStopLoss: boolean = plainPosition.trailingStopLoss;
        const protection: MidaProtection = {};

        if (Number.isFinite(takeProfit) && takeProfit !== 0) {
            protection.takeProfit = takeProfit;
        }

        if (Number.isFinite(stopLoss) && stopLoss !== 0) {
            protection.stopLoss = stopLoss;
            protection.trailingStopLoss = trailingStopLoss;
        }

        return protection;
    }

    async #getPlainOrders (fromTimestamp?: number, toTimestamp?: number): Promise<GenericObject[]> {
        const actualTimestamp: number = Date.now();
        const normalizedFromTimestamp: number = fromTimestamp ?? actualTimestamp - MidaTimeframe.W1;
        const normalizedToTimestamp: number = toTimestamp ?? actualTimestamp;
        const plainOrders: GenericObject[] = [];

        await this.#preloadOrders(normalizedFromTimestamp, normalizedToTimestamp);

        for (const plainOrder of [ ...this.#plainOrders.values(), ]) {
            if (
                Number(plainOrder.tradeData.openTimestamp) >= normalizedFromTimestamp
                && Number(plainOrder.tradeData.openTimestamp) <= normalizedToTimestamp
            ) {
                plainOrders.push(plainOrder);
            }
        }

        return plainOrders;
    }

    async #getAccountDescriptor (): Promise<GenericObject> {
        return (await this.#sendCommand("ProtoOATraderReq")).trader;
    }

    async #preloadOpenPositions (): Promise<void> {
        const accountOperativityDescriptor: GenericObject = await this.#sendCommand("ProtoOAReconcileReq");
        const plainOpenPositions: GenericObject[] = accountOperativityDescriptor.position;

        for (const plainOpenPosition of plainOpenPositions) {
            this.#plainPositions.set(plainOpenPosition.positionId, plainOpenPosition);
        }
    }

    async #preloadAssets (): Promise<void> {
        const assets: GenericObject[] = (await this.#sendCommand("ProtoOAAssetListReq")).asset;

        this.#assets.clear();
        this.#normalizedAssets.clear();
        assets.forEach((plainAsset: GenericObject): void => {
            const name: string = plainAsset.name;

            this.#assets.set(name, plainAsset);
            this.#normalizedAssets.set(name, new MidaAsset({
                asset: name,
                description: "",
                measurementUnit: "",
                tradingAccount: this,
            }));
        });
    }

    async #preloadSymbols (): Promise<void> {
        const symbols: GenericObject[] = (await this.#sendCommand("ProtoOASymbolsListReq")).symbol;

        this.#symbols.clear();
        symbols.forEach((symbol: GenericObject): void => {
            this.#symbols.set(symbol.symbolName, symbol);
        });
    }

    async #preloadDeals (fromTimestamp: number, toTimestamp: number): Promise<void> {
        const plainDeals: GenericObject[] = (await this.#connection.sendCommand("ProtoOADealListReq", {
            ctidTraderAccountId: this.#brokerAccountId,
            fromTimestamp,
            toTimestamp,
            maxRows: 1000,
        })).deal;

        for (const plainDeal of plainDeals) {
            this.#plainTrades.set(plainDeal.dealId.toString(), plainDeal);
        }
    }

    async #preloadOrders (fromTimestamp: number, toTimestamp: number): Promise<void> {
        const plainOrders: GenericObject[] = (await this.#connection.sendCommand("ProtoOAOrderListReq", {
            ctidTraderAccountId: this.#brokerAccountId,
            fromTimestamp,
            toTimestamp,
        })).order;

        for (const plainOrder of plainOrders) {
            this.#plainOrders.set(plainOrder.orderId.toString(), plainOrder);
        }
    }

    // The first tick recived after subscription will always contain the latest known bid and ask price
    #onTick (descriptor: GenericObject): void {
        const symbol: string = this.#getPlainSymbolById(descriptor.symbolId.toString())?.symbolName as string;
        const bid: number = Number(descriptor.bid) / 100000;
        const ask: number = Number(descriptor.ask) / 100000;
        const isFirstTick: boolean = !this.#lastTicks.has(symbol);
        const previousTick: MidaTick | undefined = this.#lastTicks.get(symbol);
        const movement: MidaTickMovement = ((): MidaTickMovement => {
            if (ask === 0) {
                return MidaTickMovement.BID;
            }

            if (bid === 0) {
                return MidaTickMovement.ASK;
            }

            return MidaTickMovement.BID_ASK;
        })();
        const tick: MidaTick = new MidaTick({
            symbol,
            bid: bid !== 0 ? bid : previousTick?.bid,
            ask: ask !== 0 ? ask : previousTick?.ask,
            date: new MidaDate(),
            movement,
        });

        this.#lastTicks.set(symbol, tick);
        this.#internalTickListeners.get(symbol)?.(tick);

        if (this.#tickListeners.has(symbol) && !isFirstTick) {
            this.notifyListeners("tick", { tick, });
        }
    }

    async #onUpdate (descriptor: GenericObject): Promise<void> {
        if (this.#updateEventIsLocked) {
            this.#updateEventQueue.push(descriptor);

            return;
        }

        this.#updateEventIsLocked = true;

        // <update-orders>
        const plainOrder: GenericObject = descriptor.order;

        if (plainOrder?.orderId && plainOrder.orderType && plainOrder.tradeData) {
            const orderId: string = plainOrder.orderId.toString();
            const orderAlreadyExists: boolean = this.#plainOrders.has(orderId);

            this.#plainOrders.set(orderId, plainOrder);

            if (!orderAlreadyExists && descriptor.executionType.toUpperCase() === "ORDER_ACCEPTED") {
                this.notifyListeners("order", { order: await this.normalizeOrder(plainOrder), });
            }
        }
        // </update-orders>

        // <update-trades>
        const plainTrade: GenericObject = descriptor.deal;

        if (plainTrade?.orderId && plainTrade?.dealId && plainTrade?.positionId) {
            const tradeId: string = plainTrade.dealId.toString();
            const tradeAlreadyExists: boolean = this.#plainTrades.has(tradeId);

            this.#plainTrades.set(plainTrade.dealId, plainTrade);

            if (!tradeAlreadyExists) {
                this.notifyListeners("trade", { trade: await this.normalizeTrade(plainTrade), });
            }
        }
        // </update-trades>

        // <update-positions>
        const plainPosition: GenericObject = descriptor.position;

        if (plainPosition?.positionId && plainPosition?.positionStatus) {
            this.#plainPositions.set(plainPosition.positionId, plainPosition);
        }
        // </update-positions>

        this.#cTraderEmitter.notifyListeners("execution", { descriptor, });

        // Process next event if there is any
        const nextDescriptor: GenericObject | undefined = this.#updateEventQueue.shift();
        this.#updateEventIsLocked = false;

        if (nextDescriptor) {
            this.#onUpdate(nextDescriptor);
        }
    }

    // eslint-disable-next-line max-lines-per-function
    #configureListeners (): void {
        // <execution>
        this.#connection.on("ProtoOAExecutionEvent", ({ descriptor, }): void => {
            if (descriptor.ctidTraderAccountId.toString() === this.#brokerAccountId) {
                this.#onUpdate(descriptor);
            }
        });
        // </execution>

        // <ticks>
        this.#connection.on("ProtoOASpotEvent", ({ descriptor, }): void => {
            if (descriptor.ctidTraderAccountId.toString() === this.#brokerAccountId) {
                this.#onTick(descriptor);
            }
        });
        // </ticks>

        // <symbol-update>
        this.#connection.on("ProtoOASymbolChangedEvent", ({ descriptor, }): void => {
            if (descriptor.ctidTraderAccountId.toString() !== this.#brokerAccountId) {
                return;
            }

            const symbolId: string = descriptor.symbolId.toString();
            const plainSymbol: GenericObject | undefined = this.#getPlainSymbolById(symbolId);

            if (plainSymbol) {
                this.#completeSymbols.delete(plainSymbol.symbolName);
            }

            this.preloadAssetsAndSymbols();
        });
        // </symbol-update>

        // <position-update>
        this.#connection.on("ProtoOAMarginChangedEvent", ({ descriptor, }): void => {
            if (descriptor.ctidTraderAccountId.toString() !== this.#brokerAccountId) {
                return;
            }

            // const positionId: string = descriptor.positionId.toString();
        });
        // </position-update>

        this.#connection.on("ProtoOAOrderErrorEvent", ({ descriptor, }): void => {
            this.#cTraderEmitter.notifyListeners("order-error", { descriptor, });
        });
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
        return [ ...this.#plainTrades.values(), ].find((deal: GenericObject) => deal.dealId.toString() === id);
    }

    #getDealsDescriptorsByOrderId (id: string): GenericObject[] {
        return [ ...this.#plainTrades.values(), ].filter((deal: GenericObject) => deal.orderId.toString() === id);
    }

    // eslint-disable-next-line id-length
    #getDealsDescriptorsByPositionId (id: string): GenericObject[] {
        return [ ...this.#plainTrades.values(), ].filter((deal: GenericObject) => deal.positionId.toString() === id);
    }

    #getPositionDescriptorById (id: string): GenericObject | undefined {
        return [ ...this.#plainPositions.values(), ].find((position: GenericObject) => position.positionId.toString() === id);
    }

    // eslint-disable-next-line max-lines-per-function
    public async getPlainPositionGrossProfit (plainPosition: GenericObject): Promise<number> {
        const plainSymbol: GenericObject | undefined = this.#getPlainSymbolById(plainPosition.tradeData.symbolId);
        const symbol: string = plainSymbol?.symbolName;

        if (!plainSymbol) {
            throw new Error();
        }

        const completePlainSymbol: GenericObject = await this.#getCompletePlainSymbol(symbol);
        const lotUnits: number = Number(completePlainSymbol.lotSize) / 100;
        const volume: number = Number(plainPosition.tradeData.volume) / 100 / lotUnits;
        const openPrice: number = Number(plainPosition.price);
        const lastSymbolTick: MidaTick = await this.#getSymbolLastTick(symbol);
        let direction: MidaPositionDirection;
        let closePrice: number;

        switch (plainPosition.tradeData.tradeSide.toUpperCase()) {
            case "SELL": {
                direction = MidaPositionDirection.SHORT;
                closePrice = lastSymbolTick.ask;

                break;
            }
            case "BUY": {
                direction = MidaPositionDirection.LONG;
                closePrice = lastSymbolTick.bid;

                break;
            }
            default: {
                throw new Error();
            }
        }

        let grossProfit: number;

        if (direction === MidaPositionDirection.LONG) {
            grossProfit = (closePrice - openPrice) * volume * lotUnits;
        }
        else {
            grossProfit = (openPrice - closePrice) * volume * lotUnits;
        }

        const quoteAssedId: string = plainSymbol.quoteAssetId.toString();
        const depositAssetId: string = this.#getPlainAssetByName(this.primaryAsset)?.assetId.toString() as string;
        let rate: number = 1;

        // <rate-for-conversion-to-deposit-asset>
        if (quoteAssedId !== depositAssetId) {
            let depositConversionChain: GenericObject[] = this.#depositConversionChains.get(symbol) ?? [];
            let movedAssetId: string = quoteAssedId;

            if (!depositConversionChain) {
                depositConversionChain = (await this.#sendCommand("ProtoOASymbolsForConversionReq", {
                    firstAssetId: quoteAssedId,
                    lastAssetId: depositAssetId,
                })).symbol as GenericObject[];

                this.#depositConversionChains.set(symbol, depositConversionChain);
            }

            for (const plainLightSymbol of depositConversionChain) {
                const lastLightSymbolTick: MidaTick = await this.#getSymbolLastTick(plainLightSymbol.symbolName);
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
        }
        // </rate-for-converion-to-deposit-asset>

        // Return the gross profit converted to deposit asset
        return grossProfit * rate;
    }

    public async getPlainPositionNetProfit (plainPosition: GenericObject): Promise<number> {
        const grossProfit: number = await this.getPlainPositionGrossProfit(plainPosition);
        const totalCommission: number = Number(plainPosition.commission) / 100 * 2;
        const totalSwap: number = Number(plainPosition.swap) / 100;

        return grossProfit + totalCommission + totalSwap;
    }

    public getPlainPositionById (id: string): GenericObject | undefined {
        return this.#plainPositions.get(id);
    }

    public async getPlainOrderById (id: string): Promise<GenericObject | undefined> {
        if (this.#plainOrders.has(id)) {
            return this.#plainOrders.get(id);
        }

        const W1: number = 604800000; // max. 1 week as indicated at https://spotware.github.io/open-api-docs/messages/#protooaorderlistreq
        let toTimestamp: number = Date.now();
        let fromTimestamp: number = toTimestamp - W1;
        let totalTimestamp: number = W1;

        // Since there is no interface to request an order by id, search through the orders of the past 3 weeks
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

                if (!this.#plainOrders.has(orderId)) {
                    this.#plainOrders.set(orderId, plainOrder);
                }
            }

            if (this.#plainOrders.has(id)) {
                return this.#plainOrders.get(id);
            }

            toTimestamp = fromTimestamp;
            fromTimestamp -= W1;
            totalTimestamp += W1;
        }

        return undefined;
    }

    public async getPlainDealById (id: string): Promise<GenericObject | undefined> {
        if (this.#plainTrades.has(id)) {
            return this.#plainTrades.get(id);
        }

        const { W1, } = MidaTimeframe; // max. 1 week as indicated at https://spotware.github.io/open-api-docs/messages/#protooadeallistreq
        let toTimestamp: number = Date.now();
        let fromTimestamp: number = toTimestamp - W1;
        let totalTimestamp: number = W1;

        // Since there is no interface to request a deal by id, search through the deals of the past 3 weeks
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

                if (!this.#plainTrades.has(dealId)) {
                    this.#plainTrades.set(dealId, plainDeal);
                }
            }

            if (this.#plainTrades.has(id)) {
                return this.#plainTrades.get(id);
            }

            toTimestamp = fromTimestamp;
            fromTimestamp -= W1;
            totalTimestamp += W1;
        }

        return undefined;
    }

    public async normalizeSymbolVolume (symbol: string, volume: number): Promise<number> {
        const completePlainSymbol: GenericObject = await this.#getCompletePlainSymbol(symbol);
        const lotUnits: number = Number(completePlainSymbol.lotSize) / 100;

        return volume / 100 / lotUnits;
    }

    async #sendCommand (payloadType: string, parameters?: GenericObject, messageId?: string): Promise<GenericObject> {
        return this.#connection.sendCommand(payloadType, {
            ctidTraderAccountId: this.#brokerAccountId,
            ...parameters ?? {},
        }, messageId);
    }
}

export function toCTraderTimeframe (timeframe: number): string {
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
        case 600: {
            return "M10";
        }
        case 900: {
            return "M15";
        }
        case 1800: {
            return "M30";
        }
        case 3600: {
            return "H1";
        }
        case 14400: {
            return "H4";
        }
        case 43200: {
            return "H12";
        }
        case 86400: {
            return "D1";
        }
        case 604800: {
            return "W1";
        }
        case 2592000: {
            return "MN1";
        }
        default: {
            throw new Error("Unsupported timeframe");
        }
    }
}

const getLastSunday = (date: Date): Date => {
    const lastSunday = new Date(date);

    lastSunday.setDate(lastSunday.getDate() - lastSunday.getDay());

    return lastSunday;
};
