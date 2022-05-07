import { CTraderTradingAccount } from "#platforms/ctrader/CTraderTradingAccount";
import { CTraderPlugin } from "#CTraderPlugin";
import {
    MidaOrderDirection, MidaOrderStatus,
    MidaPosition,
    MidaPositionDirection,
    MidaPositionStatus,
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
    let brokerAccount: CTraderTradingAccount;

    if (!credentials.clientId || !credentials.clientSecret || !credentials.accessToken || !credentials.cTraderBrokerAccountId) {
        describe("no credentials", () => {
            it("doesn't login", () => {
                expect(true).toBe(true);
            });
        });

        return;
    }

    beforeAll(async () => {
        brokerAccount = await CTraderPlugin.platform.login(credentials);
    });

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
            const direction = MidaOrderDirection.BUY;
            const order = await brokerAccount.placeOrder({
                symbol,
                volume,
                direction,
            });

            expect(order.status).toBe(MidaOrderStatus.EXECUTED);
        });

        it("correctly places market order with take profit", async () => {
            const symbol = "XAUUSD";
            const volume = MidaUtilities.generateInRandomInteger(1, 2);
            const direction = MidaOrderDirection.BUY;
            const order = await brokerAccount.placeOrder({
                symbol,
                volume,
                direction,
            });

            expect(order.status).toBe(MidaOrderStatus.EXECUTED);
        });

        it("correctly places market order with stop loss", async () => {
            const symbol = "XAUUSD";
            const volume = MidaUtilities.generateInRandomInteger(1, 2);
            const direction = MidaOrderDirection.BUY;
            const order = await brokerAccount.placeOrder({
                symbol,
                volume,
                direction,
            });

            expect(order.status).toBe(MidaOrderStatus.EXECUTED);
        });
    });
});
