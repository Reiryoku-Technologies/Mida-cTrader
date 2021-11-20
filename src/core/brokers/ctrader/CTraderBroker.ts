import { MidaBroker } from "@reiryoku/mida";
import { CTraderBrokerAccount } from "#brokers/ctrader/CTraderBrokerAccount";
import { CTraderBrokerLoginParameters } from "#brokers/ctrader/CTraderBrokerLoginParameters";
import { CTraderApp } from "#brokers/ctrader/CTraderApp";

export class CTraderBroker extends MidaBroker {
    public constructor () {
        super({
            name: "cTrader",
            websiteUri: "https://ctrader.com",
            legalName: "",
        });
    }

    public async login ({
        clientId,
        clientSecret,
        accessToken,
        cTraderBrokerAccountId,
    }: CTraderBrokerLoginParameters): Promise<CTraderBrokerAccount> {
        const cTraderApp: CTraderApp = await CTraderApp.create({ clientId, clientSecret, });

        return cTraderApp.login(accessToken, cTraderBrokerAccountId);
    }
}
