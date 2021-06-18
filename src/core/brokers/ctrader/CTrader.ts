import axios from "axios";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { GenericObject } from "@reiryoku/mida";
import { CTraderBrokerAccount } from "#brokers/ctrader/CTraderBrokerAccount";
import { CTraderLoginParameters } from "#brokers/ctrader/CTraderLoginParameters";

export class CTrader {
    static readonly #demoConnection: CTraderConnection = new CTraderConnection({ host: "demo.ctraderapi.com", port: 5035, });
    static readonly #liveConnection: CTraderConnection = new CTraderConnection({ host: "live.ctraderapi.com", port: 5035, });

    public static async getAccessTokenAccounts (accessToken: string): Promise<GenericObject[]> {
        return JSON.parse(await axios.get("https://api.spotware.com/connect/tradingaccounts", {
            params: {
                "access_token": accessToken,
            },
        }));
    }

    public static async getBrokerAccountById (brokerAccountId: string, accessToken: string): Promise<GenericObject | undefined> {
        const accounts: GenericObject[] = await CTrader.getAccessTokenAccounts(accessToken);

        for (const account of accounts) {
            if (account.accountId.toString() === brokerAccountId) {
                return account;
            }
        }

        return undefined;
    }

    public static async login ({
        clientId,
        clientSecret,
        accessToken,
        brokerAccountId,
    }: CTraderLoginParameters): Promise<CTraderBrokerAccount> {
        throw new Error();
    }

    static async #openConnections (): Promise<void> {
        await Promise.all([ CTrader.#demoConnection.open(), CTrader.#liveConnection.open(), ]);
    }
}
