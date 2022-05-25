import { MidaTradingPlatform, } from "@reiryoku/mida";
import { CTraderAccount, } from "#platforms/ctrader/CTraderAccount";
import { CTraderLoginParameters, } from "#platforms/ctrader/CTraderLoginParameters";
import { CTraderApplication, } from "#platforms/ctrader/CTraderApplication";

export class CTrader extends MidaTradingPlatform {
    public constructor () {
        super({ name: "cTrader", siteUri: "https://ctrader.com", });
    }

    public async login ({
        clientId,
        clientSecret,
        accessToken,
        cTraderBrokerAccountId,
    }: CTraderLoginParameters): Promise<CTraderAccount> {
        const cTraderApplication: CTraderApplication = await CTraderApplication.create({ clientId, clientSecret, });
        const tradingAccount: CTraderAccount = await cTraderApplication.loginTradingAccount(accessToken, cTraderBrokerAccountId);

        await tradingAccount.preload();

        return tradingAccount;
    }
}
