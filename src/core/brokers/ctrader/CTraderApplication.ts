import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { CTraderApplicationParameters } from "#brokers/ctrader/CTraderApplicationParameters";
import { CTraderBrokerAccount } from "#brokers/ctrader/CTraderBrokerAccount";
import {
    GenericObject,
    MidaBrokerAccountOperativity,
    MidaBrokerAccountPositionAccounting,
    MidaDate,
} from "@reiryoku/mida";
import { CTraderPlugin } from "#CTraderPlugin";

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

    public async loginBrokerAccount (accessToken: string, cTraderBrokerAccountId: string): Promise<CTraderBrokerAccount> {
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
        const positionAccounting: MidaBrokerAccountPositionAccounting = ((): MidaBrokerAccountPositionAccounting => {
            switch (accountDescriptor.accountType.toUpperCase()) {
                case "HEDGED": {
                    return MidaBrokerAccountPositionAccounting.HEDGED;
                }
                case "NETTED": {
                    return MidaBrokerAccountPositionAccounting.NETTED;
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

        return new CTraderBrokerAccount({
            id: account.traderLogin.toString(),
            broker: CTraderPlugin.broker,
            creationDate: new MidaDate(Number(accountDescriptor.registrationTimestamp)),
            ownerName: "",
            depositCurrencyIso: depositAsset.displayName.toUpperCase(),
            depositCurrencyDigits: Number(accountDescriptor.moneyDigits),
            operativity: isLive ? MidaBrokerAccountOperativity.REAL : MidaBrokerAccountOperativity.DEMO,
            positionAccounting,
            indicativeLeverage: Number(accountDescriptor.leverageInCents) / 100,
            connection,
            cTraderBrokerAccountId,
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
