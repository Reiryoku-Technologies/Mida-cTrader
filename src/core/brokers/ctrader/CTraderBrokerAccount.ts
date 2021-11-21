import {
    GenericObject,
    MidaAsset,
    MidaBrokerAccount, MidaDate,
    MidaSymbol,
    MidaBrokerDeal,
    MidaSymbolCategory,
    MidaSymbolTick,
} from "@reiryoku/mida";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { CTraderBrokerAccountParameters } from "#brokers/ctrader/CTraderBrokerAccountParameters";


// @ts-ignore
export class CTraderBrokerAccount extends MidaBrokerAccount {
    readonly #connection: CTraderConnection;
    readonly #cTraderBrokerAccountId: string;
    readonly #assetsMap: Map<string, GenericObject>;
    readonly #symbolsMap: Map<string, GenericObject>;
    readonly #watchedSymbolsMap: Map<string, number>;
    readonly #orders: Map<string, GenericObject>;
    readonly #deals: Map<string, GenericObject>;
    readonly #positions: Map<string, GenericObject>;

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
        this.#assetsMap = new Map();
        this.#symbolsMap = new Map();
        this.#watchedSymbolsMap = new Map();
        this.#orders = new Map();
        this.#deals = new Map();
        this.#positions = new Map();

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

    public override async getAssets (): Promise<MidaAsset[]> {
        await this.#updateAssetsMap();

        return [ ...this.#assetsMap.values(), ].map((asset): MidaAsset => new MidaAsset({
            id: asset.id,
            name: asset.name,
            description: "",
            measurementUnit: "",
        }));
    }

    public override async getSymbols (): Promise<string[]> {
        await this.#updateSymbolsMap();

        return [ ...this.#symbolsMap.values(), ].map((symbol): string => symbol.symbolName);
    }

    public override async getSymbol (symbol: string): Promise<MidaSymbol | undefined> {
        await this.#updateSymbolsMap();

        const symbolDescriptor = this.#symbolsMap.get(symbol);

        if (!symbolDescriptor) {
            return undefined;
        }

        const completeSymbol: any = (await this.#connection.sendCommand("ProtoOASymbolByIdReq", {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
            symbolId: symbolDescriptor.symbolId,
        })).symbol[0];
        const lotUnits = Number(completeSymbol.lotSize) / 100;

        return new MidaSymbol({
            symbol,
            brokerAccount: this,
            description: symbolDescriptor.description,
            type: MidaSymbolCategory.FOREX,
            digits: completeSymbol.digits,
            leverage: 30,
            minLots: Number(completeSymbol.minVolume) / 100 / lotUnits,
            maxLots: Number(completeSymbol.maxVolume) / 100 / lotUnits,
            lotUnits,
        });
    }

    public override async watchSymbolTicks (symbol: string): Promise<void> {
        await this.#updateSymbolsMap();

        const symbolDescriptor = this.#symbolsMap.get(symbol);

        if (!symbolDescriptor) {
            return undefined;
        }

        const listenersCount: number = this.#watchedSymbolsMap.get(symbol) ?? 0;

        if (listenersCount === 0) {
            await this.#connection.sendCommand("ProtoOASubscribeSpotsReq", {
                ctidTraderAccountId: this.#cTraderBrokerAccountId,
                symbolId: symbolDescriptor.symbolId,
                // subscribeToSpotTimestamp: true,
            });
        }

        this.#watchedSymbolsMap.set(symbol, listenersCount + 1);
    }

    public override async getDeals (fromTimestamp: number, toTimestamp: number): Promise<MidaBrokerDeal[]> {
        return [];
    }

    async #getAccountDescriptor (): Promise<GenericObject> {
        return (await this.#connection.sendCommand("ProtoOATraderReq", {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
        })).trader;
    }

    async #updateAssetsMap (): Promise<void> {
        const assetsMap: Map<string, GenericObject> = this.#assetsMap;
        const assets: GenericObject[] = (await this.#connection.sendCommand("ProtoOAAssetListReq", {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
        })).asset;

        assetsMap.clear();
        assets.forEach((asset: GenericObject): void => {
            assetsMap.set(asset.name, asset);
        });
    }

    async #updateSymbolsMap (): Promise<void> {
        const symbolsMap: Map<string, GenericObject> = this.#symbolsMap;
        const symbols: GenericObject[] = (await this.#connection.sendCommand("ProtoOASymbolsListReq", {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
        })).symbol;

        symbolsMap.clear();
        symbols.forEach((symbol: GenericObject): void => {
            symbolsMap.set(symbol.symbolName, symbol);
        });
    }

    #onTick (descriptor: GenericObject): void {
        this.notifyListeners("tick", {
            tick: new MidaSymbolTick({
                symbol: "BTCUSD",
                bid: Number(descriptor.bid) / 100 / 1000,
                ask: Number(descriptor.ask) / 100 / 1000,
                date: new MidaDate(),
            }),
        });
    }

    #onExecution (descriptor: GenericObject): void {

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

    #descriptorToDeal (descriptor: GenericObject): MidaBrokerDeal {
        const id = descriptor.dealId.toString();
        const orderId = descriptor.orderId.toString();
        const positionId = descriptor.positionId.toString();
        const requestedVolume = Number(descriptor.volume) / 100;
        const filledVolume = Number(descriptor.filledVolume) / 100;
        const symbolId = descriptor.symbolId.toString();
        const requestDate = new MidaDate({ timestamp: Number(descriptor.createTimestamp), });
        const executionDate = new MidaDate({ timestamp: Number(descriptor.executionTimestamp), });

        // @ts-ignore
        return undefined;
    }
}
