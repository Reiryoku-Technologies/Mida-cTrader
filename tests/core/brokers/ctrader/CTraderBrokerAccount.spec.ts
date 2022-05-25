import { CTraderAccount, } from "#platforms/ctrader/CTraderAccount";
import { CTraderPlugin, } from "#CTraderPlugin";
import {
    MidaOrderDirection, MidaOrderStatus,
    MidaPosition,
    MidaPositionDirection,
    MidaPositionStatus,
    MidaUtilities,
} from "@reiryoku/mida";
import { expect, } from "@jest/globals";

// eslint-disable-next-line max-lines-per-function
describe("CTraderBrokerAccount", () => {
    const credentials = {
        clientId: "",
        clientSecret: "",
        accessToken: "",
        cTraderBrokerAccountId: "",
    };
    let tradingAccount: CTraderAccount;

    if (!credentials.clientId || !credentials.clientSecret || !credentials.accessToken || !credentials.cTraderBrokerAccountId) {
        describe("no credentials", () => {
            it("doesn't login", () => {
                expect(true).toBe(true);
            });
        });

        return;
    }

    beforeAll(async () => {
        tradingAccount = await CTraderPlugin.platform.login(credentials) as CTraderAccount;
    });

    beforeEach(async () => {
        // Used to avoid rate limiting on the API usage
        await MidaUtilities.wait(5000);
    });

    describe(".getBalance", () => {
        it("returns a number type", async () => {
            const balance = await tradingAccount.getBalance();

            expect(typeof balance).toBe("number");
        });
    });

    // eslint-disable-next-line max-lines-per-function
    describe(".placeOrder", () => {
        it("correctly places market order", async () => {
            const symbol = "XAUUSD";
            const volume = MidaUtilities.generateInRandomInteger(1, 2);
            const direction = MidaOrderDirection.BUY;
            const order = await tradingAccount.placeOrder({
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
            const order = await tradingAccount.placeOrder({
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
            const order = await tradingAccount.placeOrder({
                symbol,
                volume,
                direction,
            });

            expect(order.status).toBe(MidaOrderStatus.EXECUTED);
        });
    });
});
