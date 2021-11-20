import { GenericObject, MidaBrokerAccount } from "@reiryoku/mida";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { CTraderBrokerAccountParameters } from "#brokers/ctrader/CTraderBrokerAccountParameters";

// @ts-ignore
export class CTraderBrokerAccount extends MidaBrokerAccount {
    readonly #connection: CTraderConnection;
    readonly #cTraderBrokerAccountId: string;

    public constructor ({
        id,
        ownerName,
        type,
        currency,
        broker,
        connection,
        cTraderBrokerAccountId,
    }: CTraderBrokerAccountParameters) {
        super({
            id,
            ownerName,
            type,
            currency,
            broker,
        });

        this.#connection = connection;
        this.#cTraderBrokerAccountId = cTraderBrokerAccountId;
    }

    public get cTraderBrokerAccountId (): string {
        return this.#cTraderBrokerAccountId;
    }

    public async getBalance (): Promise<number> {
        const accountDescriptor: GenericObject = await this.#connection.sendCommand("ProtoOATraderReq", {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
        });
        const balance = Number(accountDescriptor.balance);

        if (!Number.isFinite(balance)) {
            throw new Error();
        }

        return balance;
    }

    #configureListeners (): void {

    }
}
