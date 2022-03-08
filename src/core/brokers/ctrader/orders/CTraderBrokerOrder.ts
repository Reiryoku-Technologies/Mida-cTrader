import {
    GenericObject,
    MidaBrokerOrder,
    MidaBrokerOrderRejectionType,
    MidaBrokerOrderStatus,
    MidaDate,
} from "@reiryoku/mida";
import { CTraderBrokerOrderParameters } from "#brokers/ctrader/orders/CTraderBrokerOrderParameters";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { CTraderBrokerAccount } from "#brokers/ctrader/CTraderBrokerAccount";

export class CTraderBrokerOrder extends MidaBrokerOrder {
    // The uuid associated to the order request
    readonly #uuid: string;
    readonly #connection: CTraderConnection;
    readonly #updateEventQueue: GenericObject[];
    #updateEventIsLocked: boolean;
    #updateEventUuid?: string;
    #rejectEventUuid?: string;

    public constructor ({
        id,
        brokerAccount,
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
        deals,
        position,
        rejectionType,
        isStopOut,
        uuid,
        connection,
    }: CTraderBrokerOrderParameters) {
        super({
            id,
            brokerAccount,
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
            deals,
            position,
            rejectionType,
            isStopOut,
        });

        this.#uuid = uuid;
        this.#connection = connection;
        this.#updateEventQueue = [];
        this.#updateEventIsLocked = false;
        this.#updateEventUuid = undefined;
        this.#rejectEventUuid = undefined;

        // Listen events only if the order is not in a final state
        if (
            status !== MidaBrokerOrderStatus.CANCELLED &&
            status !== MidaBrokerOrderStatus.REJECTED &&
            status !== MidaBrokerOrderStatus.EXPIRED &&
            status !== MidaBrokerOrderStatus.FILLED
        ) {
            this.#configureListeners();
        }
    }

    get #cTraderBrokerAccount (): CTraderBrokerAccount {
        return this.brokerAccount as CTraderBrokerAccount;
    }

    get #cTraderBrokerAccountId (): string {
        return this.#cTraderBrokerAccount.cTraderBrokerAccountId;
    }

    public override async cancel (): Promise<void> {
        if (this.status !== MidaBrokerOrderStatus.PENDING) {
            return;
        }

        this.#connection.sendCommand("ProtoOACancelOrderReq", {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
            orderId: this.id,
        });
    }

    // eslint-disable-next-line max-lines-per-function
    async #onUpdate (descriptor: GenericObject): Promise<void> {
        if (this.#updateEventIsLocked) {
            this.#updateEventQueue.push(descriptor);

            return;
        }

        this.#updateEventIsLocked = true;

        const order: GenericObject = descriptor.order;
        const orderId: string = order.orderId.toString();
        const orderCreationTimestamp: number = Number(order.tradeData.openTimestamp);
        const positionId: string = order.positionId.toString();

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
                this.onStatusChange(MidaBrokerOrderStatus.ACCEPTED);

                if (order.orderType.toUpperCase() !== "MARKET") {
                    this.onStatusChange(MidaBrokerOrderStatus.PENDING);
                }

                break;
            }
            case "ORDER_PARTIAL_FILL":
            case "ORDER_FILLED": {
                this.#removeEventsListeners();

                this.position = this.position ?? await this.brokerAccount.getPositionById(positionId);

                this.onDeal(await this.#cTraderBrokerAccount.normalizePlainDeal(descriptor.deal));
                this.onStatusChange(
                    descriptor.executionType === "ORDER_FILLED" ? MidaBrokerOrderStatus.FILLED : MidaBrokerOrderStatus.PARTIALLY_FILLED
                );

                break;
            }
            case "ORDER_CANCELLED": {
                this.#removeEventsListeners();
                this.onStatusChange(MidaBrokerOrderStatus.CANCELLED);

                break;
            }
            case "ORDER_EXPIRED": {
                this.#removeEventsListeners();
                this.onStatusChange(MidaBrokerOrderStatus.EXPIRED);

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

        this.lastUpdateDate = new MidaDate();

        switch (descriptor.errorCode) {
            case "MARKET_CLOSED":
            case "SYMBOL_HAS_HOLIDAY": {
                this.rejectionType = MidaBrokerOrderRejectionType.MARKET_CLOSED;

                break;
            }
            case "SYMBOL_NOT_FOUND":
            case "UNKNOWN_SYMBOL": {
                this.rejectionType = MidaBrokerOrderRejectionType.SYMBOL_NOT_FOUND;

                break;
            }
            case "TRADING_DISABLED": {
                this.rejectionType = MidaBrokerOrderRejectionType.SYMBOL_DISABLED;

                break;
            }
            case "NOT_ENOUGH_MONEY": {
                this.rejectionType = MidaBrokerOrderRejectionType.NOT_ENOUGH_MONEY;

                break;
            }
            case "TRADING_BAD_VOLUME": {
                this.rejectionType = MidaBrokerOrderRejectionType.INVALID_VOLUME;

                break;
            }
            default: {
                // @ts-ignore
                this.rejectionType = `UNKNOWN REJECTION TYPE | ${descriptor.errorCode}`;
            }
        }

        this.onStatusChange(MidaBrokerOrderStatus.REJECTED);
    }

    #configureListeners (): void {
        // <order-execution>
        this.#updateEventUuid = this.#connection.on("ProtoOAExecutionEvent", ({ descriptor, }): void => {
            const orderId: string | undefined = descriptor?.order?.orderId?.toString();

            if (
                descriptor.ctidTraderAccountId.toString() === this.#cTraderBrokerAccountId &&
                (orderId && orderId === this.id || descriptor.clientMsgId === this.#uuid)
            ) {
                this.#onUpdate(descriptor); // Not using await is intended
            }
        });
        // </order-execution>

        // <request-validation-errors>
        this.#rejectEventUuid = this.#connection.on("ProtoOAOrderErrorEvent", ({ descriptor, }): void => {
            const orderId: string | undefined = descriptor?.order?.orderId?.toString();

            if (
                descriptor.ctidTraderAccountId.toString() === this.#cTraderBrokerAccountId &&
                (orderId && orderId === this.id || descriptor.clientMsgId === this.#uuid)
            ) {
                this.#onReject(descriptor);
            }
        });
        // </request-validation-errors>
    }

    #removeEventsListeners (): void {
        if (this.#updateEventUuid) {
            this.#connection.removeEventListener(this.#updateEventUuid);

            this.#updateEventUuid = undefined;
        }

        if (this.#rejectEventUuid) {
            this.#connection.removeEventListener(this.#rejectEventUuid);

            this.#rejectEventUuid = undefined;
        }
    }
}
