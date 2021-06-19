import {
    MidaBroker,
    MidaBrokerParameters,
} from "@reiryoku/mida";
import { CTraderBrokerAccount } from "#brokers/ctrader/CTraderBrokerAccount";

export class CTraderBroker extends MidaBroker {
    public constructor ({ name, websiteUri, }: MidaBrokerParameters) {
        super({ name, websiteUri, });
    }

    public async login (): Promise<CTraderBrokerAccount> {
        throw new Error();
    }

    static #usedBrokers: Map<string, CTraderBroker> = new Map();
}
