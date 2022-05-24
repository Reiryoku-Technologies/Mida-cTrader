import { MidaTradingPlatform } from "@reiryoku/mida";
import { CTraderTradingAccount } from "#platforms/ctrader/CTraderTradingAccount";
import { CTraderLoginParameters } from "#platforms/ctrader/CTraderLoginParameters";
import { CTraderApplication } from "#platforms/ctrader/CTraderApplication";

export class CTrader extends MidaTradingPlatform {
    public constructor () {
        super({ name: "cTrader", siteUri: "https://ctrader.com", });
    }

    public async login ({
        clientId,
        clientSecret,
        accessToken,
        cTraderBrokerAccountId,
    }: CTraderLoginParameters): Promise<CTraderTradingAccount> {
        const cTraderApplication: CTraderApplication = await CTraderApplication.create({ clientId, clientSecret, });
        const tradingAccount: CTraderTradingAccount = await cTraderApplication.loginTradingAccount(accessToken, cTraderBrokerAccountId);

        await tradingAccount.preload();

        return tradingAccount;
    }
}
