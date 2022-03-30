import { CTraderBrokerAccount } from "#brokers/ctrader/CTraderBrokerAccount";
import { CTraderPlugin } from "#CTraderPlugin";
import {
    MidaBrokerOrderDirection,
    MidaBrokerPosition,
    MidaBrokerPositionDirection,
    MidaBrokerPositionStatus,
    MidaUtilities,
} from "@reiryoku/mida";
import { expect } from "@jest/globals";

// eslint-disable-next-line max-lines-per-function
describe("CTraderBrokerAccount", () => {
    const credentials = {
        clientId: "",
        clientSecret: "",
        accessToken: "",
        cTraderBrokerAccountId: "",
    };
    let brokerAccount: CTraderBrokerAccount;

    if (!credentials.clientId || !credentials.clientSecret || !credentials.accessToken || !credentials.cTraderBrokerAccountId) {
        describe("no credentials", () => {
            it("doesn't login", () => {
                expect(true).toBe(true);
            });
        });

        return;
    }

    beforeAll(async () => {
        brokerAccount = await CTraderPlugin.broker.login(credentials);
    });

    afterAll((async () => {
        await brokerAccount.logout();
    }));

    beforeEach(async () => {
        // Used to avoid rate limiting on the API usage
        await MidaUtilities.wait(5000);
    });

    describe(".getBalance", () => {
        it("returns a number type", async () => {
            const balance = await brokerAccount.getBalance();

            expect(typeof balance).toBe("number");
        });
    });

    // eslint-disable-next-line max-lines-per-function
    describe(".placeOrder", () => {
        it("correctly places market order", async () => {
            const symbol = "XAUUSD";
            const volume = MidaUtilities.generateInRandomInteger(1, 2);
            const direction = MidaBrokerOrderDirection.BUY;
            const order = await brokerAccount.placeOrder({
                symbol,
                volume,
                direction,
            });
            const position = order.position as MidaBrokerPosition;

            expect(position).toBeInstanceOf(MidaBrokerPosition);
            expect(position.symbol).toBe(symbol);
            expect(position.volume).toBe(volume);
            expect(position.status).toBe(MidaBrokerPositionStatus.OPEN);
            expect(position.direction).toBe(MidaBrokerPositionDirection.LONG);
        });

        it("correctly places market order with take profit", async () => {
            const symbol = "XAUUSD";
            const volume = MidaUtilities.generateInRandomInteger(1, 2);
            const direction = MidaBrokerOrderDirection.BUY;
            const takeProfit: number = 5000;
            const order = await brokerAccount.placeOrder({
                symbol,
                volume,
                direction,
            });
            const position = order.position as MidaBrokerPosition;

            expect(position).toBeInstanceOf(MidaBrokerPosition);
            expect(position.symbol).toBe(symbol);
            expect(position.volume).toBe(volume);
            expect(position.status).toBe(MidaBrokerPositionStatus.OPEN);
            expect(position.direction).toBe(MidaBrokerPositionDirection.LONG);

            await position.changeProtection({ takeProfit, });

            expect(position.takeProfit).toBe(takeProfit);
        });

        it("correctly places market order with stop loss", async () => {
            const symbol = "XAUUSD";
            const volume = MidaUtilities.generateInRandomInteger(1, 2);
            const direction = MidaBrokerOrderDirection.BUY;
            const stopLoss: number = 1000;
            const order = await brokerAccount.placeOrder({
                symbol,
                volume,
                direction,
            });
            const position = order.position as MidaBrokerPosition;

            expect(position).toBeInstanceOf(MidaBrokerPosition);
            expect(position.symbol).toBe(symbol);
            expect(position.volume).toBe(volume);
            expect(position.status).toBe(MidaBrokerPositionStatus.OPEN);
            expect(position.direction).toBe(MidaBrokerPositionDirection.LONG);

            await position.changeProtection({ stopLoss, });

            expect(position.stopLoss).toBe(stopLoss);
        });
    });
});
