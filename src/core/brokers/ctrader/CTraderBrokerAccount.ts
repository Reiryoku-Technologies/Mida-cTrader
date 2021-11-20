import { GenericObject, MidaBrokerAccount } from "@reiryoku/mida";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { CTraderBrokerAccountParameters } from "#brokers/ctrader/CTraderBrokerAccountParameters";

// @ts-ignore
export class CTraderBrokerAccount extends MidaBrokerAccount {
    readonly #connection: CTraderConnection;
    readonly #cTraderBrokerAccountId: string;
    readonly #symbolsMap: Map<string, GenericObject>;

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
        this.#symbolsMap = new Map();
    }

    public get cTraderBrokerAccountId (): string {
        return this.#cTraderBrokerAccountId;
    }

    public async getBalance (): Promise<number> {
        const accountDescriptor: GenericObject = await this.#getAccountDescriptor();
        const balance = Number(accountDescriptor.balance.toString());

        if (!Number.isFinite(balance)) {
            throw new Error();
        }

        return balance / 100;
    }

    public async getSymbols (): Promise<string[]> {
        await this.#updateSymbolsMap();

        return [ ...this.#symbolsMap.values(), ].map((symbol): string => symbol.symbolName);
    }

    async #getAccountDescriptor (): Promise<GenericObject> {
        return (await this.#connection.sendCommand("ProtoOATraderReq", {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
        })).trader;
    }

    async #updateSymbolsMap (): Promise<void> {
        const symbols: GenericObject[] = (await this.#connection.sendCommand("ProtoOASymbolsListReq", {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
        })).symbol;

        this.#symbolsMap.clear();

        symbols.forEach((symbol: GenericObject): void => {
            this.#symbolsMap.set(symbol.symbolName, symbol);
        });
    }

    #configureListeners (): void {

    }
}
