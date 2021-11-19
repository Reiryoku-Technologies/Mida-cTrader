import { MidaBroker } from "@reiryoku/mida";
import { CTraderBrokerAccount } from "#brokers/ctrader/CTraderBrokerAccount";
import { CTraderBrokerParameters } from "#brokers/ctrader/CTraderBrokerParameters";

export class CTraderBroker extends MidaBroker {
    readonly #cTraderBrokerLegalName: string;

    public constructor ({ cTraderBrokerLegalName, }: CTraderBrokerParameters) {
        super({
            name: "cTrader",
            websiteUri: "https://ctrader.com",
        });

        this.#cTraderBrokerLegalName = cTraderBrokerLegalName;
    }

    public get cTraderBrokerLegalName (): string {
        return this.#cTraderBrokerLegalName;
    }

    public async login (): Promise<CTraderBrokerAccount> {
        throw new Error();
    }
}
