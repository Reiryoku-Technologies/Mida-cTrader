/*
 * Copyright Reiryoku Technologies and its contributors, www.reiryoku.com, www.mida.org
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
*/

import {
    GenericObject,
    MidaDate,
    MidaEmitter,
    MidaOrder,
    MidaOrderRejection,
    MidaOrderStatus,
    MidaPosition,
    MidaPositionStatus,
    MidaProtectionDirectives,
} from "@reiryoku/mida";
import { CTraderOrderParameters, } from "#platforms/ctrader/orders/CTraderOrderParameters";
import { CTraderAccount, } from "#platforms/ctrader/CTraderAccount";
import { CTraderConnection, } from "@reiryoku/ctrader-layer";

export class CTraderOrder extends MidaOrder {
    // The uuid associated to the order request
    readonly #uuid: string;
    readonly #connection: CTraderConnection;
    readonly #cTraderEmitter: MidaEmitter;
    readonly #requestedProtection?: MidaProtectionDirectives;
    readonly #updateEventQueue: GenericObject[];
    #updateEventIsLocked: boolean;
    #updateEventUuid?: string;
    #rejectEventUuid?: string;

    public constructor ({
        id,
        tradingAccount,
        symbol,
        requestedVolume,
        direction,
        purpose,
        limitPrice,
        stopPrice,
        status,
        creationDate,
        lastUpdateDate,
        timeInForce,
        trades,
        rejection,
        isStopOut,
        uuid,
        connection,
        cTraderEmitter,
        requestedProtection,
    }: CTraderOrderParameters) {
        super({
            id,
            tradingAccount,
            symbol,
            requestedVolume,
            direction,
            purpose,
            limitPrice,
            stopPrice,
            status,
            creationDate,
            lastUpdateDate,
            timeInForce,
            trades,
            rejection,
            isStopOut,
        });

        this.#uuid = uuid;
        this.#connection = connection;
        this.#cTraderEmitter = cTraderEmitter;
        this.#requestedProtection = requestedProtection;
        this.#updateEventQueue = [];
        this.#updateEventIsLocked = false;
        this.#updateEventUuid = undefined;
        this.#rejectEventUuid = undefined;

        // Listen events only if the order is not in a final state
        if (
            status !== MidaOrderStatus.CANCELLED &&
            status !== MidaOrderStatus.REJECTED &&
            status !== MidaOrderStatus.EXPIRED &&
            status !== MidaOrderStatus.EXECUTED
        ) {
            this.#configureListeners();
        }
    }

    get #cTraderTradingAccount (): CTraderAccount {
        return this.tradingAccount as CTraderAccount;
    }

    get #brokerAccountId (): string {
        return this.#cTraderTradingAccount.brokerAccountId;
    }

    public override async cancel (): Promise<void> {
        if (this.status !== MidaOrderStatus.PENDING) {
            return;
        }

        await this.#connection.sendCommand("ProtoOACancelOrderReq", {
            ctidTraderAccountId: this.#brokerAccountId,
            orderId: this.id,
        });
    }

    // eslint-disable-next-line max-lines-per-function, complexity
    async #onUpdate (descriptor: GenericObject): Promise<void> {
        if (this.#updateEventIsLocked) {
            this.#updateEventQueue.push(descriptor);

            return;
        }

        this.#updateEventIsLocked = true;

        const order: GenericObject = descriptor.order;
        const orderId: string = order.orderId.toString();
        const orderCreationTimestamp: number = Number(order.tradeData.openTimestamp);

        if (!this.id && orderId) {
            this.id = orderId;
        }

        if (Number.isFinite(orderCreationTimestamp) && !this.creationDate) {
            this.creationDate = new MidaDate(orderCreationTimestamp);
        }

        const lastUpdateTimestamp: number = Number(order.utcLastUpdateTimestamp);

        if (Number.isFinite(lastUpdateTimestamp) && (!this.lastUpdateDate || this.lastUpdateDate.timestamp !== lastUpdateTimestamp)) {
            this.lastUpdateDate = new MidaDate(lastUpdateTimestamp);
        }

        switch (descriptor.executionType) {
            case "ORDER_ACCEPTED": {
                this.onStatusChange(MidaOrderStatus.ACCEPTED);

                if (order.orderType.toUpperCase() !== "MARKET") {
                    this.onStatusChange(MidaOrderStatus.PENDING);
                }

                break;
            }
            case "ORDER_PARTIAL_FILL":
            case "ORDER_FILLED": {
                if (!this.positionId) {
                    this.positionId = order.positionId.toString();
                }

                this.onTrade(this.#cTraderTradingAccount.normalizeTrade(descriptor.deal));

                // Enters if the order is executed
                if (order.orderStatus.toUpperCase() === "ORDER_STATUS_FILLED") {
                    if (order.orderType.toUpperCase() === "MARKET" && this.#requestedProtection) {
                        const position: MidaPosition | undefined = await this.getPosition();

                        if (position && position.status === MidaPositionStatus.OPEN) {
                            await position.changeProtection(this.#requestedProtection);
                        }
                    }

                    this.#removeEventsListeners();
                    this.onStatusChange(MidaOrderStatus.EXECUTED);
                }

                break;
            }
            case "ORDER_CANCELLED": {
                this.#removeEventsListeners();
                this.onStatusChange(MidaOrderStatus.CANCELLED);

                break;
            }
            case "ORDER_EXPIRED": {
                this.#removeEventsListeners();
                this.onStatusChange(MidaOrderStatus.EXPIRED);

                break;
            }
            case "ORDER_REJECTED": {
                this.#onReject(descriptor);

                break;
            }
        }

        // Process next event if there is any
        const nextDescriptor: GenericObject | undefined = this.#updateEventQueue.shift();
        this.#updateEventIsLocked = false;

        if (nextDescriptor) {
            this.#onUpdate(nextDescriptor);
        }
    }

    #onReject (descriptor: GenericObject): void {
        this.#removeEventsListeners();

        this.creationDate = new MidaDate();
        this.lastUpdateDate = new MidaDate();

        switch (descriptor.errorCode) {
            case "MARKET_CLOSED":
            case "SYMBOL_HAS_HOLIDAY": {
                this.rejection = MidaOrderRejection.MARKET_CLOSED;

                break;
            }
            case "SYMBOL_NOT_FOUND":
            case "UNKNOWN_SYMBOL": {
                this.rejection = MidaOrderRejection.SYMBOL_NOT_FOUND;

                break;
            }
            case "TRADING_DISABLED": {
                this.rejection = MidaOrderRejection.SYMBOL_TRADING_DISABLED;

                break;
            }
            case "NOT_ENOUGH_MONEY": {
                this.rejection = MidaOrderRejection.NOT_ENOUGH_MONEY;

                break;
            }
            case "TRADING_BAD_VOLUME": {
                this.rejection = MidaOrderRejection.INVALID_VOLUME;

                break;
            }
            default: {
                this.rejection = MidaOrderRejection.UNKNOWN;

                console.log("Unknown cTrader Open API error");
                console.log(descriptor);
                console.log("Consult the cTrader Open API documentation to find a complete explanation");
            }
        }

        this.onStatusChange(MidaOrderStatus.REJECTED);
    }

    #configureListeners (): void {
        // <order-execution>
        this.#updateEventUuid = this.#cTraderEmitter.on("execution", (event): void => {
            const descriptor: GenericObject = event.descriptor.descriptor;
            const orderId: string | undefined = descriptor?.order?.orderId?.toString();

            if (
                descriptor.ctidTraderAccountId.toString() === this.#brokerAccountId &&
                (orderId && orderId === this.id || descriptor.clientMsgId === this.#uuid)
            ) {
                this.#onUpdate(descriptor); // Not using await is intended
            }
        });
        // </order-execution>

        // <request-validation-errors>
        this.#rejectEventUuid = this.#cTraderEmitter.on("order-error", (event): void => {
            const descriptor: GenericObject = event.descriptor.descriptor;
            const orderId: string | undefined = descriptor?.order?.orderId?.toString();

            if (
                descriptor.ctidTraderAccountId.toString() === this.#brokerAccountId &&
                (orderId && orderId === this.id || descriptor.clientMsgId === this.#uuid)
            ) {
                this.#onReject(descriptor);
            }
        });
        // </request-validation-errors>
    }

    #removeEventsListeners (): void {
        if (this.#updateEventUuid) {
            this.#cTraderEmitter.removeEventListener(this.#updateEventUuid);

            this.#updateEventUuid = undefined;
        }

        if (this.#rejectEventUuid) {
            this.#cTraderEmitter.removeEventListener(this.#rejectEventUuid);

            this.#rejectEventUuid = undefined;
        }
    }
}
