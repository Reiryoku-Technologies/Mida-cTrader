/*
 * Copyright Reiryoku Technologies and its contributors, www.reiryoku.com, www.mida.org
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
*/

import {
    date,
    decimal,
    fatal,
    GenericObject,
    MidaAsset,
    MidaAssetStatement,
    MidaDate,
    MidaDecimal,
    MidaEmitter,
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
    MidaSymbolTradeStatus,
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
    uuid, warn,
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
    readonly #periodListeners: Map<string, number[]>;
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
        this.#periodListeners = new Map();
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
        await Promise.all([ this.#preloadAssets(), this.#preloadPlainSymbols(), ]);
    }

    public async preload (): Promise<void> {
        await Promise.all([ this.preloadAssetsAndSymbols(), this.#preloadPlainOpenPositions(), ]);
    }

    public override async getBalance (): Promise<MidaDecimal> {
        const accountDescriptor: GenericObject = await this.#getAccountDescriptor();

        return decimal(accountDescriptor.balance).divide(100);
    }

    public override async getBalanceSheet (): Promise<MidaAssetStatement[]> {
        if ((await this.getBalance()).greaterThan(0)) {
            return [ await this.getAssetBalance(this.primaryAsset), ];
        }

        return [];
    }

    public override async getUsedMargin (): Promise<MidaDecimal> {
        let usedMargin: MidaDecimal = decimal(0);

        for (const plainOpenPosition of this.plainOpenPositions) {
            usedMargin = usedMargin.add(plainOpenPosition.usedMargin);
        }

        return usedMargin.divide(100);
    }

    public override async getEquity (): Promise<MidaDecimal> {
        const unrealizedNetProfits: MidaDecimal[] = await Promise.all(
            this.plainOpenPositions.map((plainOpenPosition: GenericObject) => this.getPlainPositionNetProfit(plainOpenPosition))
        );
        let equity: MidaDecimal = await this.getBalance();

        for (const unrealizedNetProfit of unrealizedNetProfits) {
            equity = equity.add(unrealizedNetProfit);
        }

        return equity;
    }

    public override async getAssets (): Promise<string[]> {
        return [ ...this.#normalizedAssets.keys(), ];
    }

    // https://help.ctrader.com/open-api/model-messages/#protooainterval
    public override async isSymbolMarketOpen (symbol: string): Promise<boolean> {
        const completeSymbol: GenericObject = this.#getCompletePlainSymbol(symbol);
        const schedules: GenericObject[] = completeSymbol.schedule;
        const actualDate: Date = new Date();
        const actualTimestamp: number = actualDate.getTime();
        const lastSundayTimestamp: number = getLastSunday(actualDate).getTime();

        for (const schedule of schedules) {
            if (
                actualTimestamp >= (lastSundayTimestamp + schedule.startSecond * 1000) &&
                actualTimestamp < (lastSundayTimestamp + schedule.endSecond * 1000)
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
            periods.push(normalizePeriod(plainPeriod, symbol));
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
        const plainSymbol: GenericObject | undefined = this.#symbols.get(symbol);

        if (!plainSymbol) {
            return undefined;
        }

        let normalizedSymbol: MidaSymbol | undefined = this.#normalizedSymbols.get(symbol);

        if (normalizedSymbol) {
            return normalizedSymbol;
        }

        const completePlainSymbol: GenericObject = this.#getCompletePlainSymbol(symbol);
        const lotUnits: MidaDecimal = decimal(completePlainSymbol.lotSize).divide(100);
        normalizedSymbol = new MidaSymbol({
            symbol,
            tradingAccount: this,
            description: plainSymbol.description,
            baseAsset: this.getAssetById(plainSymbol.baseAssetId)?.toString() as string,
            quoteAsset: this.getAssetById(plainSymbol.quoteAssetId)?.toString() as string,
            leverage: decimal(-1), // TODO: Add leverage
            minLots: decimal(completePlainSymbol.minVolume).divide(lotUnits).divide(100),
            maxLots: decimal(completePlainSymbol.maxVolume).divide(lotUnits).divide(100),
            lotUnits,
            pipPosition: Number(completePlainSymbol.pipPosition),
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
                date: date(),
                asset,
                freeVolume: await this.getFreeMargin(),
                lockedVolume: await this.getUsedMargin(),
                borrowedVolume: decimal(0),
            };
        }

        return {
            tradingAccount: this,
            date: date(),
            asset,
            freeVolume: decimal(0),
            lockedVolume: decimal(0),
            borrowedVolume: decimal(0),
        };
    }

    public override async getCryptoAssetDepositAddress (asset: string, net: string): Promise<string> {
        throw new MidaUnsupportedOperationError();
    }

    public override async watchSymbolTicks (symbol: string): Promise<void> {
        const symbolDescriptor: GenericObject | undefined = this.#symbols.get(symbol);

        if (!symbolDescriptor) {
            fatal(`Symbol "${symbol}" not found`);

            throw new Error();
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

    public override async watchSymbolPeriods (symbol: string, timeframe: number): Promise<void> {
        const symbolDescriptor: GenericObject | undefined = this.#symbols.get(symbol);

        if (!symbolDescriptor) {
            fatal(`Symbol "${symbol}" not found`);

            throw new Error();
        }

        // Periods subscription requires ticks subscription
        await this.watchSymbolTicks(symbol);

        const listenedTimeframes: number[] = this.#periodListeners.get(symbol) ?? [];

        if (!listenedTimeframes.includes(timeframe)) {
            await this.#sendCommand("ProtoOASubscribeLiveTrendbarReq", {
                symbolId: symbolDescriptor.symbolId,
                period: toCTraderTimeframe(timeframe),
            });
            listenedTimeframes.push(timeframe);
            this.#periodListeners.set(symbol, listenedTimeframes);
        }
    }

    public override async getOrders (symbol: string): Promise<MidaOrder[]> {
        const normalizedFromTimestamp: number = Date.now() - 1000 * 60 * 60 * 24 * 3;
        const normalizedToTimestamp: number = Date.now();
        const orders: MidaOrder[] = [];
        const plainOrders: GenericObject[] = await this.#getPlainOrders(normalizedFromTimestamp, normalizedToTimestamp);

        for (const plainOrder of plainOrders) {
            orders.push(this.normalizeOrder(plainOrder));
        }

        return orders.filter((order: MidaOrder): boolean => order.symbol === symbol);
    }

    public override async getPendingOrders (): Promise<MidaOrder[]> {
        const pendingOrders: MidaOrder[] = [];

        for (const plainOrder of [ ...this.#plainOrders.values(), ]) {
            if (plainOrder.orderStatus === "ORDER_STATUS_ACCEPTED" && plainOrder.orderType.toUpperCase() !== "MARKET") {
                pendingOrders.push(this.normalizeOrder(plainOrder));
            }
        }

        return pendingOrders;
    }

    public override async getTrades (symbol: string): Promise<MidaTrade[]> {
        const normalizedFromTimestamp: number = Date.now() - 1000 * 60 * 60 * 24 * 3;
        const normalizedToTimestamp: number = Date.now();

        await this.#preloadTrades(normalizedFromTimestamp, normalizedToTimestamp);

        return [ ...this.#plainTrades.values(), ]
            .map((plainTrade: GenericObject) => this.normalizeTrade(plainTrade))
            .filter((deal: MidaTrade): boolean => deal.symbol === symbol);
    }

    public override async getDate (): Promise<MidaDate> {
        return date();
    }

    async #getSymbolLastTick (symbol: string): Promise<MidaTick> {
        // Check if symbol ticks are already being listened
        if (this.#lastTicks.has(symbol)) {
            // Return the last tick
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
        return this.plainOpenPositions.map(
            (plainPosition: GenericObject) => this.normalizePosition(plainPosition)
        ) as MidaPosition[];
    }

    // eslint-disable-next-line max-lines-per-function
    public normalizeOrder (plainOrder: GenericObject): CTraderOrder {
        const orderId: string = plainOrder.orderId.toString();
        const tradeSide: string = plainOrder.tradeData.tradeSide.toUpperCase();
        const symbol: string = this.#getPlainSymbolById(plainOrder.tradeData.symbolId)?.symbolName;
        const completePlainSymbol: GenericObject = this.#getCompletePlainSymbol(symbol);
        const lotUnits: MidaDecimal = decimal(completePlainSymbol.lotSize).divide(100);
        const requestedVolume: MidaDecimal = decimal(plainOrder.tradeData.volume).divide(100).divide(lotUnits);
        const purpose: MidaOrderPurpose = plainOrder.closingOrder === false ? MidaOrderPurpose.OPEN : MidaOrderPurpose.CLOSE;
        const openDate: MidaDate = date(plainOrder.tradeData.openTimestamp);
        const direction: MidaOrderDirection = tradeSide === "SELL" ? MidaOrderDirection.SELL : MidaOrderDirection.BUY;
        const limitPrice: MidaDecimal | undefined = plainOrder.limitPrice ? decimal(plainOrder.limitPrice) : undefined;
        const stopPrice: MidaDecimal | undefined = plainOrder.stopPrice ? decimal(plainOrder.stopPrice) : undefined;
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

        return new CTraderOrder({
            id: orderId,
            positionId: plainOrder.positionId.toString(),
            tradingAccount: this,
            symbol,
            requestedVolume,
            direction,
            purpose,
            limitPrice,
            stopPrice,
            status,
            creationDate: openDate,
            lastUpdateDate: date(plainOrder.utcLastUpdateTimestamp),
            timeInForce: normalizeTimeInForce(plainOrder.timeInForce),
            trades: [],
            rejection: undefined,
            isStopOut: plainOrder.isStopOut === true,
            uuid: plainOrder.clientOrderId || undefined,
            connection: this.#connection,
            cTraderEmitter: this.#cTraderEmitter,
        });
    }

    public normalizePosition (plainPosition: GenericObject): CTraderPosition {
        const symbol: string = this.#getPlainSymbolById(plainPosition.tradeData.symbolId.toString())?.symbolName;
        const completePlainSymbol: GenericObject = this.#getCompletePlainSymbol(symbol);
        const lotUnits: MidaDecimal = decimal(completePlainSymbol.lotSize).divide(100);
        const volume: MidaDecimal = decimal(plainPosition.tradeData.volume).divide(lotUnits).divide(100);

        return new CTraderPosition({
            id: plainPosition.positionId.toString(),
            tradingAccount: this,
            volume,
            symbol,
            protection: this.normalizeProtection({
                takeProfit: plainPosition.takeProfit,
                stopLoss: plainPosition.stopLoss,
                trailingStopLoss: plainPosition.trailingStopLoss,
            }),
            direction: plainPosition.tradeData.tradeSide === "BUY" ? MidaPositionDirection.LONG : MidaPositionDirection.SHORT,
            connection: this.#connection,
            cTraderEmitter: this.#cTraderEmitter,
        });
    }

    public override async getSymbolBid (symbol: string): Promise<MidaDecimal> {
        return (await this.#getSymbolLastTick(symbol)).bid;
    }

    public override async getSymbolAsk (symbol: string): Promise<MidaDecimal> {
        return (await this.#getSymbolLastTick(symbol)).ask;
    }

    public override async getSymbolAverage (symbol: string): Promise<MidaDecimal> {
        const { bid, ask, } = await this.#getSymbolLastTick(symbol);

        return bid.add(ask).divide(2);
    }

    public override async getSymbolTradeStatus (symbol: string): Promise<MidaSymbolTradeStatus> {
        const completePlainSymbol: GenericObject = this.#getCompletePlainSymbol(symbol);

        switch (completePlainSymbol.tradingMode.toUpperCase()) {
            case "ENABLED": {
                return MidaSymbolTradeStatus.ENABLED;
            }
            case "DISABLED_WITH_PENDINGS_EXECUTION":
            case "DISABLED_WITHOUT_PENDINGS_EXECUTION": {
                return MidaSymbolTradeStatus.DISABLED;
            }
            case "CLOSE_ONLY_MODE": {
                return MidaSymbolTradeStatus.CLOSE_ONLY;
            }
            default: {
                warn("Unknown symbol trading mode");

                return "" as MidaSymbolTradeStatus;
            }
        }
    }

    // eslint-disable-next-line max-lines-per-function, complexity
    public override async placeOrder (directives: MidaOrderDirectives): Promise<CTraderOrder> {
        const internalId: string = uuid();
        const positionId: string | undefined = directives.positionId;
        const limitPrice: MidaDecimal | undefined = directives.limit !== undefined ? decimal(directives.limit) : undefined;
        const stopPrice: MidaDecimal | undefined = directives.stop !== undefined ? decimal(directives.stop) : undefined;
        let symbol: string | undefined = undefined;
        let requestedVolume: MidaDecimal | undefined = directives.volume !== undefined ? decimal(directives.volume) : undefined;
        let existingPosition: CTraderPosition | undefined = undefined;
        let purpose: MidaOrderPurpose;
        let requestDirectives: GenericObject = {};

        // Check if directives are related to an existing position
        if (positionId) {
            const plainPosition: GenericObject = this.#plainPositions.get(positionId) as GenericObject;
            existingPosition = this.normalizePosition(plainPosition);
            symbol = existingPosition.symbol;

            if (!requestedVolume) {
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
        else if (directives.symbol) {
            purpose = MidaOrderPurpose.OPEN;
            symbol = directives.symbol;
        }
        else {
            fatal("Invalid directives");

            throw new Error();
        }

        if (!requestedVolume) {
            fatal("Invalid volume");

            throw new Error();
        }

        const timeInForce: MidaOrderTimeInForce = directives.timeInForce ?? MidaOrderTimeInForce.GOOD_TILL_CANCEL;
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
            timeInForce,
            trades: [],
            rejection: undefined,
            isStopOut: false, // Stop out orders are sent by the platform
            uuid: internalId,
            connection: this.#connection,
            cTraderEmitter: this.#cTraderEmitter,
            requestedProtection: directives.protection,
        });

        const plainSymbol: GenericObject = this.#symbols.get(symbol) as GenericObject;
        const completePlainSymbol: GenericObject = this.#getCompletePlainSymbol(symbol);
        const lotUnits: MidaDecimal = decimal(completePlainSymbol.lotSize).divide(100);
        const normalizedVolume: MidaDecimal = requestedVolume.multiply(lotUnits).multiply(100);

        requestDirectives = {
            symbolId: plainSymbol.symbolId.toString(),
            volume: normalizedVolume.toString(),
            tradeSide: directives.direction === MidaOrderDirection.BUY ? "BUY" : "SELL",
            timeInForce: toCTraderTimeInForce(timeInForce),
        };

        const label: string | undefined = directives.label;

        if (label) {
            requestDirectives.label = label;
        }

        if (timeInForce === MidaOrderTimeInForce.GOOD_TILL_DATE) {
            const { expirationDate, } = directives;

            if (expirationDate === undefined) {
                fatal("Expiration date is required for GOOD_TILL_DATE orders");

                throw new Error();
            }

            requestDirectives.expirationTimestamp = date(expirationDate).timestamp;
        }

        if (!existingPosition) {
            const {
                stopLoss,
                takeProfit,
                trailingStopLoss,
            } = directives.protection ?? {};

            if (limitPrice) {
                requestDirectives.orderType = "LIMIT";
                requestDirectives.limitPrice = Number(limitPrice.toString());
            }
            else if (stopPrice) {
                requestDirectives.orderType = "STOP";
                requestDirectives.stopPrice = Number(stopPrice.toString());
            }
            else {
                requestDirectives.orderType = "MARKET";
            }

            // cTrader Open API doesn't allow using absolute protection on market orders
            // Protection is set on market orders after the order is executed
            if (requestDirectives.orderType !== "MARKET") {
                if (stopLoss !== undefined) {
                    requestDirectives.stopLoss = decimal(stopLoss).toString();
                }

                if (takeProfit !== undefined) {
                    requestDirectives.takeProfit = decimal(takeProfit).toString();
                }

                if (trailingStopLoss) {
                    requestDirectives.trailingStopLoss = true;
                }
            }
        }
        else {
            requestDirectives.positionId = positionId;
            requestDirectives.orderType = "MARKET";
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

        this.#sendCommand("ProtoOANewOrderReq", requestDirectives, internalId);

        return resolver;
    }

    // eslint-disable-next-line max-lines-per-function
    public normalizeTrade (plainTrade: GenericObject): CTraderTrade {
        const id: string = plainTrade.dealId.toString();
        const orderId: string = plainTrade.orderId.toString();
        const symbol: string = this.#getPlainSymbolById(plainTrade.symbolId.toString())?.symbolName;
        const completePlainSymbol: GenericObject = this.#getCompletePlainSymbol(symbol);
        const lotUnits: MidaDecimal = decimal(completePlainSymbol.lotSize).divide(100);
        const filledVolume: MidaDecimal = decimal(plainTrade.filledVolume).divide(lotUnits).divide(100);
        let direction: MidaTradeDirection;

        switch (plainTrade.tradeSide.toUpperCase()) {
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

        switch (plainTrade.dealStatus.toUpperCase()) {
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

        const purpose: MidaTradePurpose = plainTrade.closePositionDetail ? MidaTradePurpose.CLOSE : MidaTradePurpose.OPEN;
        const executionDate = date(plainTrade.executionTimestamp);
        const rejectionDate: MidaDate | undefined = undefined;
        const plainExecutionPrice: string = plainTrade.executionPrice;
        const plainGrossProfit: string | undefined = plainTrade?.closePositionDetail?.grossProfit;
        const plainCommission: string | undefined = plainTrade.commission;
        const plainSwap: string | undefined = plainTrade?.closePositionDetail?.swap;

        return new CTraderTrade({
            id,
            orderId,
            positionId: plainTrade.positionId.toString(),
            volume: filledVolume,
            direction,
            status,
            purpose,
            executionDate,
            rejectionDate,
            executionPrice: plainExecutionPrice ? decimal(plainExecutionPrice) : undefined,
            grossProfit: plainGrossProfit ? decimal(plainGrossProfit).divide(100) : undefined,
            commission: plainCommission ? decimal(plainCommission).divide(100) : undefined,
            commissionAsset: this.primaryAsset,
            swap: plainSwap ? decimal(plainSwap).divide(100) : undefined,
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

    public normalizeProtection (plainPosition: GenericObject): MidaProtection {
        const takeProfit: MidaDecimal | undefined = plainPosition.takeProfit ? decimal(plainPosition.takeProfit) : undefined;
        const stopLoss: MidaDecimal | undefined = plainPosition.stopLoss ? decimal(plainPosition.stopLoss) : undefined;
        const trailingStopLoss: boolean = Boolean(plainPosition.trailingStopLoss);
        const protection: MidaProtection = {};

        if (takeProfit) {
            protection.takeProfit = takeProfit;
        }

        if (stopLoss) {
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

    async #preloadPlainOpenPositions (): Promise<void> {
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

    async #preloadPlainSymbols (): Promise<void> {
        // <light-symbols>
        const plainSymbols: GenericObject[] = (await this.#sendCommand("ProtoOASymbolsListReq")).symbol;

        this.#symbols.clear();
        plainSymbols.forEach((plainSymbol: GenericObject): void => {
            this.#symbols.set(plainSymbol.symbolName, plainSymbol);
        });
        // </light-symbols>

        // <complete-symbols>
        const completePlainSymbols: GenericObject[] = (await this.#sendCommand("ProtoOASymbolByIdReq", {
            symbolId: plainSymbols.map((plainSymbol) => plainSymbol.symbolId),
        })).symbol;

        this.#completeSymbols.clear();
        completePlainSymbols.forEach((completePlainSymbol: GenericObject): void => {
            this.#completeSymbols.set(completePlainSymbol.symbolId, completePlainSymbol);
        });
        // </complete-symbols>
    }

    async #preloadTrades (fromTimestamp: number, toTimestamp: number): Promise<void> {
        const plainTrades: GenericObject[] = (await this.#connection.sendCommand("ProtoOADealListReq", {
            ctidTraderAccountId: this.#brokerAccountId,
            fromTimestamp,
            toTimestamp,
        })).deal;

        for (const plainTrade of plainTrades) {
            this.#plainTrades.set(plainTrade.dealId.toString(), plainTrade);
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
        const bid: MidaDecimal | undefined = descriptor.bid ? decimal(descriptor.bid).divide(100000) : undefined;
        const ask: MidaDecimal | undefined = descriptor.ask ? decimal(descriptor.ask).divide(100000) : undefined;
        const isFirstTick: boolean = !this.#lastTicks.has(symbol);
        const previousTick: MidaTick | undefined = this.#lastTicks.get(symbol);
        const movement: MidaTickMovement = ((): MidaTickMovement => {
            if (!ask) {
                return MidaTickMovement.BID;
            }

            if (!bid) {
                return MidaTickMovement.ASK;
            }

            return MidaTickMovement.BID_ASK;
        })();
        const tick: MidaTick = new MidaTick({
            symbol,
            bid: bid ?? previousTick?.bid,
            ask: ask ?? previousTick?.ask,
            date: date(),
            movement,
        });

        this.#lastTicks.set(symbol, tick);
        this.#internalTickListeners.get(symbol)?.(tick);

        if (this.#tickListeners.has(symbol) && !isFirstTick) {
            this.notifyListeners("tick", { tick, });
        }

        const listenedTimeframes: number[] = this.#periodListeners.get(symbol) ?? [];

        for (const plainPeriod of descriptor.trendbar ?? []) {
            const period: MidaPeriod = normalizePeriod(plainPeriod, symbol, tick);

            if (listenedTimeframes.includes(period.timeframe)) {
                this.notifyListeners("period-update", { period, });
            }
        }
    }

    #onUpdate (descriptor: GenericObject): void {
        // <update-orders>
        const plainOrder: GenericObject = descriptor.order;

        if (plainOrder?.orderId && plainOrder.orderType && plainOrder.tradeData) {
            const orderId: string = plainOrder.orderId.toString();
            const orderAlreadyExists: boolean = this.#plainOrders.has(orderId);

            this.#plainOrders.set(orderId, plainOrder);

            if (!orderAlreadyExists && descriptor.executionType.toUpperCase() === "ORDER_ACCEPTED") {
                this.notifyListeners("order", { order: this.normalizeOrder(plainOrder), });
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
                this.notifyListeners("trade", { trade: this.normalizeTrade(plainTrade), });
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
                this.#completeSymbols.delete(plainSymbol.symbolId);
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

    #getCompletePlainSymbol (symbol: string): GenericObject {
        const plainSymbol: GenericObject | undefined = this.#symbols.get(symbol) as GenericObject;

        if (!plainSymbol) {
            fatal(`Symbol ${symbol} not found`);

            throw new Error();
        }

        const completePlainSymbol: GenericObject | undefined = this.#completeSymbols.get(plainSymbol.symbolId);

        if (!completePlainSymbol) {
            fatal(`Symbol ${symbol} not found`);

            throw new Error();
        }

        return completePlainSymbol;
    }

    #getPlainAssetById (id: string): GenericObject | undefined {
        return [ ...this.#assets.values(), ].find((asset: GenericObject) => asset.assetId.toString() === id);
    }

    #getPlainAssetByName (name: string): GenericObject | undefined {
        return [ ...this.#assets.values(), ].find((asset: GenericObject) => asset.name === name);
    }

    // eslint-disable-next-line max-lines-per-function
    public async getPlainPositionGrossProfit (plainPosition: GenericObject): Promise<MidaDecimal> {
        const plainSymbol: GenericObject | undefined = this.#getPlainSymbolById(plainPosition.tradeData.symbolId);
        const symbol: string = plainSymbol?.symbolName;

        if (!plainSymbol) {
            throw new Error();
        }

        const completePlainSymbol: GenericObject = this.#getCompletePlainSymbol(symbol);
        const lotUnits: MidaDecimal = decimal(completePlainSymbol.lotSize).divide(100);
        const volume: MidaDecimal = decimal(plainPosition.tradeData.volume).divide(100).divide(lotUnits);
        const openPrice: MidaDecimal = decimal(plainPosition.price);
        const lastSymbolTick: MidaTick = await this.#getSymbolLastTick(symbol);
        let direction: MidaPositionDirection;
        let closePrice: MidaDecimal;

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

        let grossProfit: MidaDecimal;

        if (direction === MidaPositionDirection.LONG) {
            grossProfit = closePrice.subtract(openPrice).multiply(volume).multiply(lotUnits);
        }
        else {
            grossProfit = openPrice.subtract(closePrice).multiply(volume).multiply(lotUnits);
        }

        const quoteAssedId: string = plainSymbol.quoteAssetId.toString();
        const depositAssetId: string = this.#getPlainAssetByName(this.primaryAsset)?.assetId.toString() as string;
        let depositExchangeRate: MidaDecimal = decimal(1);

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
                const supposedClosePrice: MidaDecimal = lastLightSymbolTick.ask;

                if (plainLightSymbol.baseAssetId.toString() === movedAssetId) {
                    depositExchangeRate = depositExchangeRate.multiply(supposedClosePrice);
                    movedAssetId = plainLightSymbol.quoteAssetId.toString();
                }
                else {
                    depositExchangeRate = depositExchangeRate.multiply(decimal(1).divide(supposedClosePrice));
                    movedAssetId = plainLightSymbol.baseAssetId.toString();
                }
            }
        }
        // </rate-for-converion-to-deposit-asset>

        // Return the gross profit converted to deposit asset
        return grossProfit.multiply(depositExchangeRate);
    }

    public async getPlainPositionNetProfit (plainPosition: GenericObject): Promise<MidaDecimal> {
        const grossProfit: MidaDecimal = await this.getPlainPositionGrossProfit(plainPosition);
        const totalCommission: MidaDecimal = decimal(plainPosition.commission).divide(100).multiply(2);
        const totalSwap: MidaDecimal = decimal(plainPosition.swap).divide(100);

        return grossProfit.add(totalCommission).add(totalSwap);
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

    async #sendCommand (payloadType: string, parameters?: GenericObject, messageId?: string): Promise<GenericObject> {
        return this.#connection.sendCommand(payloadType, {
            ctidTraderAccountId: this.#brokerAccountId,
            ...parameters ?? {},
        }, messageId);
    }
}

export const toCTraderTimeframe = (timeframe: number): string => {
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
};

export const normalizeTimeframe = (timeframe: string): number => {
    switch (timeframe) {
        case "M1": {
            return 60;
        }
        case "M2": {
            return 120;
        }
        case "M3": {
            return 180;
        }
        case "M4": {
            return 240;
        }
        case "M5": {
            return 300;
        }
        case "M10": {
            return 600;
        }
        case "M15": {
            return 900;
        }
        case "M30": {
            return 1800;
        }
        case "H1": {
            return 3600;
        }
        case "H4": {
            return 14400;
        }
        case "H12": {
            return 43200;
        }
        case "D1": {
            return 86400;
        }
        case "W1": {
            return 604800;
        }
        case "MN1": {
            return 2592000;
        }
        default: {
            throw new Error("Unsupported timeframe");
        }
    }
};

export const toCTraderTimeInForce = (timeInForce: MidaOrderTimeInForce): string => {
    switch (timeInForce) {
        case MidaOrderTimeInForce.GOOD_TILL_DATE: {
            return "GOOD_TILL_DATE";
        }
        case MidaOrderTimeInForce.GOOD_TILL_CANCEL: {
            return "GOOD_TILL_CANCEL";
        }
        case MidaOrderTimeInForce.IMMEDIATE_OR_CANCEL: {
            return "IMMEDIATE_OR_CANCEL";
        }
        case MidaOrderTimeInForce.FILL_OR_KILL: {
            return "FILL_OR_KILL";
        }
        default: {
            throw new Error("Unsupported time in force");
        }
    }
};

export const normalizeTimeInForce = (timeInForce: string): MidaOrderTimeInForce => {
    switch (timeInForce) {
        case "GOOD_TILL_DATE": {
            return MidaOrderTimeInForce.GOOD_TILL_DATE;
        }
        case "GOOD_TILL_CANCEL": {
            return MidaOrderTimeInForce.GOOD_TILL_CANCEL;
        }
        case "IMMEDIATE_OR_CANCEL": {
            return MidaOrderTimeInForce.IMMEDIATE_OR_CANCEL;
        }
        case "FILL_OR_KILL": {
            return MidaOrderTimeInForce.FILL_OR_KILL;
        }
        default: {
            throw new Error("Unsupported time in force");
        }
    }
};

export const normalizePeriod = (plainPeriod: GenericObject, symbol: string, lastTick?: MidaTick): MidaPeriod => {
    const low: MidaDecimal = decimal(plainPeriod.low).divide(100000);
    const isClosed: boolean = !lastTick;

    return new MidaPeriod({
        symbol,
        startDate: date(Number(plainPeriod.utcTimestampInMinutes) * 1000 * 60),
        quotationPrice: MidaQuotationPrice.BID,
        open: low.add(decimal(plainPeriod.deltaOpen).divide(100000)),
        high: low.add(decimal(plainPeriod.deltaHigh).divide(100000)),
        low,
        close: isClosed ? low.add(decimal(plainPeriod.deltaClose).divide(100000)) : lastTick?.bid as MidaDecimal,
        isClosed,
        volume: decimal(plainPeriod.volume),
        timeframe: normalizeTimeframe(plainPeriod.period),
    });
};

const getLastSunday = (date: Date): Date => {
    const lastSunday = new Date(date);

    lastSunday.setUTCDate(lastSunday.getUTCDate() - lastSunday.getUTCDay());
    lastSunday.setUTCHours(0, 0, 0, 0);

    return lastSunday;
};
