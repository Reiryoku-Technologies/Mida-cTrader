import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { CTraderAppParameters } from "#brokers/ctrader/CTraderAppParameters";
import { CTraderBrokerAccount } from "#brokers/ctrader/CTraderBrokerAccount";

export class CTraderApp {
    readonly #clientId: string;
    readonly #clientSecret: string;
    readonly #demoConnection: CTraderConnection;
    readonly #liveConnection: CTraderConnection;
    #isConnected: boolean;
    #isAuthenticated: boolean;

    private constructor ({ clientId, clientSecret, }: CTraderAppParameters) {
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

    public async authenticateApp (): Promise<void> {
        await this.#demoConnection.sendCommand(this.#demoConnection.getPayloadTypeByName("ProtoOAApplicationAuthReq"), {
            clientId: this.#clientId,
            clientSecret: this.#clientSecret,
        });
        await this.#liveConnection.sendCommand(this.#demoConnection.getPayloadTypeByName("ProtoOAApplicationAuthReq"), {
            clientId: this.#clientId,
            clientSecret: this.#clientSecret,
        });

        this.#isAuthenticated = true;
    }

    public async login (accessToken: string, brokerAccountId: string): Promise<CTraderBrokerAccount> {
        throw new Error();
    }

    static readonly #apps: Map<string, CTraderApp> = new Map();

    public static async create ({ clientId, clientSecret, }: CTraderAppParameters): Promise<CTraderApp> {
        const app: CTraderApp = CTraderApp.#apps.get(clientId) ?? new CTraderApp({ clientId, clientSecret, });

        if (!app.isConnected) {
            await app.openConnections();
        }

        if (!app.isAuthenticated) {
            await app.authenticateApp();
        }

        CTraderApp.#apps.set(clientId, app);

        return app;
    }
}
