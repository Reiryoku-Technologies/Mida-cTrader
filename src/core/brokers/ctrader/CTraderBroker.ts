import { MidaBroker } from "@reiryoku/mida";
import { CTraderBrokerAccount } from "#brokers/ctrader/CTraderBrokerAccount";
import { CTraderBrokerLoginParameters } from "#brokers/ctrader/CTraderBrokerLoginParameters";
import { CTraderApplication } from "#brokers/ctrader/CTraderApplication";

export class CTraderBroker extends MidaBroker {
    public constructor () {
        super({
            name: "cTrader",
            legalName: "cTrader",
            websiteUri: "https://ctrader.com",
        });
    }

    public async login ({
        clientId,
        clientSecret,
        accessToken,
        cTraderBrokerAccountId,
    }: CTraderBrokerLoginParameters): Promise<CTraderBrokerAccount> {
        const cTraderApp: CTraderApplication = await CTraderApplication.create({ clientId, clientSecret, });
        const brokerAccount: CTraderBrokerAccount = await cTraderApp.login(accessToken, cTraderBrokerAccountId);

        await brokerAccount.preloadAssetsAndSymbols();

        return brokerAccount;
    }
}
