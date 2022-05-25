import { CTraderConnection, } from "@reiryoku/ctrader-layer";
import { CTraderApplicationParameters, } from "#platforms/ctrader/CTraderApplicationParameters";
import { CTraderAccount, } from "#platforms/ctrader/CTraderAccount";
import {
    GenericObject,
    MidaTradingAccountOperativity,
    MidaTradingAccountPositionAccounting,
    MidaDate,
} from "@reiryoku/mida";
import { CTraderPlugin, } from "#CTraderPlugin";

export class CTraderApplication {
    readonly #clientId: string;
    readonly #clientSecret: string;
    readonly #demoConnection: CTraderConnection;
    readonly #liveConnection: CTraderConnection;
    #demoHeartbeatIntervalId: any;
    #liveHeartbeatIntervalId: any;
    #isConnected: boolean;
    #isAuthenticated: boolean;

    private constructor ({ clientId, clientSecret, }: CTraderApplicationParameters) {
        this.#clientId = clientId;
        this.#clientSecret = clientSecret;
        this.#demoConnection = new CTraderConnection({ host: "demo.ctraderapi.com", port: 5035, });
        this.#liveConnection = new CTraderConnection({ host: "live.ctraderapi.com", port: 5035, });
        this.#isConnected = false;
        this.#isAuthenticated = false;
    }

    public get isConnected (): boolean {
        return this.#isConnected;
    }

    public get isAuthenticated (): boolean {
        return this.#isAuthenticated;
    }

    public async openConnections (): Promise<void> {
        await Promise.all([ this.#demoConnection.open(), this.#liveConnection.open(), ]);

        this.#isConnected = true;
    }

    public async authenticate (): Promise<void> {
        // <demo>
        const demoConnection = this.#demoConnection;

        await demoConnection.sendCommand("ProtoOAApplicationAuthReq", {
            clientId: this.#clientId,
            clientSecret: this.#clientSecret,
        });

        this.#demoHeartbeatIntervalId = setInterval(() => demoConnection.sendHeartbeat(), 25000);
        // </demo>

        // <live>
        const liveConnection = this.#liveConnection;

        await liveConnection.sendCommand("ProtoOAApplicationAuthReq", {
            clientId: this.#clientId,
            clientSecret: this.#clientSecret,
        });

        this.#liveHeartbeatIntervalId = setInterval(() => liveConnection.sendHeartbeat(), 25000);
        // </live>

        this.#isAuthenticated = true;
    }

    public async loginTradingAccount (accessToken: string, cTraderBrokerAccountId: string): Promise<CTraderAccount> {
        const accounts = (await this.#demoConnection.sendCommand("ProtoOAGetAccountListByAccessTokenReq", { accessToken, })).ctidTraderAccount;
        const account = accounts.find((account: GenericObject) => account.ctidTraderAccountId.toString() === cTraderBrokerAccountId);

        if (!account) {
            throw new Error();
        }

        const isLive = account.isLive === true;
        const connection: CTraderConnection = isLive ? this.#liveConnection : this.#demoConnection;

        await connection.sendCommand("ProtoOAAccountAuthReq", {
            accessToken,
            ctidTraderAccountId: cTraderBrokerAccountId,
        });

        const accountDescriptor: GenericObject = (await connection.sendCommand("ProtoOATraderReq", {
            ctidTraderAccountId: cTraderBrokerAccountId,
        })).trader;
        const positionAccounting: MidaTradingAccountPositionAccounting = ((): MidaTradingAccountPositionAccounting => {
            switch (accountDescriptor.accountType.toUpperCase()) {
                case "HEDGED": {
                    return MidaTradingAccountPositionAccounting.HEDGED;
                }
                case "NETTED": {
                    return MidaTradingAccountPositionAccounting.NETTED;
                }
                default: {
                    throw new Error();
                }
            }
        })();
        const assets: GenericObject[] = (await connection.sendCommand("ProtoOAAssetListReq", {
            ctidTraderAccountId: cTraderBrokerAccountId,
        })).asset;
        // eslint-disable-next-line max-len
        const depositAsset: GenericObject = assets.find((asset: GenericObject) => asset.assetId.toString() === accountDescriptor.depositAssetId.toString()) as GenericObject;

        return new CTraderAccount({
            id: account.traderLogin.toString(),
            platform: CTraderPlugin.platform,
            creationDate: new MidaDate(Number(accountDescriptor.registrationTimestamp)),
            ownerName: "",
            primaryAsset: depositAsset.displayName.toUpperCase(),
            operativity: isLive ? MidaTradingAccountOperativity.REAL : MidaTradingAccountOperativity.DEMO,
            positionAccounting,
            indicativeLeverage: Number(accountDescriptor.leverageInCents) / 100,
            connection,
            brokerAccountId: cTraderBrokerAccountId,
            brokerName: accountDescriptor.brokerName,
        });
    }

    /* *** *** *** Reiryoku Technologies *** *** *** */

    static readonly #applications: Map<string, CTraderApplication> = new Map();

    public static async create ({ clientId, clientSecret, }: CTraderApplicationParameters): Promise<CTraderApplication> {
        const application: CTraderApplication = CTraderApplication.#applications.get(clientId) ?? new CTraderApplication({ clientId, clientSecret, });

        if (!application.isConnected) {
            await application.openConnections();
        }

        if (!application.isAuthenticated) {
            await application.authenticate();
        }

        CTraderApplication.#applications.set(clientId, application);

        return application;
    }
}
