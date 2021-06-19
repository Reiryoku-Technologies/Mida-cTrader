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
        const accountDescriptor: GenericObject = await this.#connection.sendCommand(this.#connection.getPayloadTypeByName("ProtoOATraderReq"), {
            ctidTraderAccountId: this.#cTraderAccountId,
        });

        return Number.parseFloat(accountDescriptor.balance);
    }

    #configureListeners (): void {

    }
}
