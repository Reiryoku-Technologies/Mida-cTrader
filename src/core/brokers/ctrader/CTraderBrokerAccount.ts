import { GenericObject, MidaBrokerAccount } from "@reiryoku/mida";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { CTraderBrokerAccountParameters } from "#brokers/ctrader/CTraderBrokerAccountParameters";

// @ts-ignore
export class CTraderBrokerAccount extends MidaBrokerAccount {
    readonly #connection: CTraderConnection;
    readonly #cTraderAccountId: string;

    public constructor ({
        id,
        ownerName,
        type,
        currency,
        broker,
        connection,
        cTraderAccountId,
    }: CTraderBrokerAccountParameters) {
        super({
            id,
            ownerName,
            type,
            currency,
            broker,
        });

        this.#connection = connection;
        this.#cTraderAccountId = cTraderAccountId;
    }

    public get cTraderAccountId (): string {
        return this.#cTraderAccountId;
    }

    public async getBalance (): Promise<number> {
        const accountDescriptor: GenericObject = await this.#connection.sendCommand("ProtoOATraderReq", {
            ctidTraderAccountId: this.#cTraderAccountId,
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
