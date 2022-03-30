import {
    GenericObject,
    MidaBrokerOrderStatus,
    MidaBrokerPosition,
    MidaBrokerPositionProtection,
    MidaBrokerPositionProtectionChange, MidaBrokerPositionProtectionChangeStatus,
    MidaBrokerPositionStatus,
    MidaUtilities,
} from "@reiryoku/mida";
import { CTraderBrokerPositionParameters } from "#brokers/ctrader/positions/CTraderBrokerPositionParameters";
import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { CTraderBrokerAccount } from "#brokers/ctrader/CTraderBrokerAccount";
import { CTraderBrokerOrder } from "#brokers/ctrader/orders/CTraderBrokerOrder";

export class CTraderBrokerPosition extends MidaBrokerPosition {
    readonly #connection: CTraderConnection;
    readonly #updateEventQueue: GenericObject[];
    #updateEventIsLocked: boolean;
    #updateEventUuid?: string;
    readonly #protectionChangePendingRequests: Map<string, [ MidaBrokerPositionProtection, Function, ]>;

    public constructor ({
        id,
        orders,
        protection,
        connection,
    }: CTraderBrokerPositionParameters) {
        super({
            id,
            orders,
            protection,
        });

        this.#connection = connection;
        this.#updateEventQueue = [];
        this.#updateEventIsLocked = false;
        this.#updateEventUuid = undefined;
        this.#protectionChangePendingRequests = new Map();

        this.#configureListeners();
    }

    get #cTraderBrokerAccount (): CTraderBrokerAccount {
        return this.brokerAccount as CTraderBrokerAccount;
    }

    get #cTraderBrokerAccountId (): string {
        return this.#cTraderBrokerAccount.cTraderBrokerAccountId;
    }

    public override async getUsedMargin (): Promise<number> {
        if (this.status === MidaBrokerPositionStatus.CLOSED) {
            return 0;
        }

        const accountOperativityStatus: GenericObject = await this.#sendCommand("ProtoOAReconcileReq");
        const plainOpenPositions: GenericObject[] = accountOperativityStatus.position;
        let usedMargin: number = 0;

        for (const plainOpenPosition of plainOpenPositions) {
            if (plainOpenPosition.positionId === this.id) {
                usedMargin += Number(plainOpenPosition.usedMargin);
            }
        }

        return usedMargin / 100;
    }

    public override async getUnrealizedSwap (): Promise<number> {
        if (this.status === MidaBrokerPositionStatus.CLOSED) {
            return 0;
        }

        const accountOperativityStatus: GenericObject = await this.#sendCommand("ProtoOAReconcileReq");
        const plainOpenPositions: GenericObject[] = accountOperativityStatus.position;
        let swap: number = 0;

        for (const plainOpenPosition of plainOpenPositions) {
            if (plainOpenPosition.positionId === this.id) {
                swap += Number(plainOpenPosition.swap);
            }
        }

        return swap / 100;
    }

    public override async getUnrealizedCommission (): Promise<number> {
        if (this.status === MidaBrokerPositionStatus.CLOSED) {
            return 0;
        }

        const accountOperativityStatus: GenericObject = await this.#sendCommand("ProtoOAReconcileReq");
        const plainOpenPositions: GenericObject[] = accountOperativityStatus.position;
        let commission: number = 0;

        for (const plainOpenPosition of plainOpenPositions) {
            if (plainOpenPosition.positionId === this.id) {
                commission += Number(plainOpenPosition.commission);
            }
        }

        return commission / 100;
    }

    public override async getUnrealizedGrossProfit (): Promise<number> {
        if (this.status === MidaBrokerPositionStatus.CLOSED) {
            return 0;
        }

        const accountOperativityStatus: GenericObject = await this.#sendCommand("ProtoOAReconcileReq");
        const plainOpenPositions: GenericObject[] = accountOperativityStatus.position;
        let unrealizedGrossProfit: number = 0;

        for (const plainOpenPosition of plainOpenPositions) {
            if (plainOpenPosition.positionId === this.id) {
                unrealizedGrossProfit += await this.#cTraderBrokerAccount.getPlainPositionGrossProfit(plainOpenPosition);
            }
        }

        return unrealizedGrossProfit / 100;
    }

    public override async changeProtection (protection: MidaBrokerPositionProtection): Promise<MidaBrokerPositionProtectionChange> {
        const requestDescriptor: GenericObject = {
            positionId: this.id,
            stopLoss: this.stopLoss,
            takeProfit: this.takeProfit,
            trailingStopLoss: this.trailingStopLoss,
        };

        if ("stopLoss" in protection) {
            requestDescriptor.stopLoss = protection.stopLoss;
        }

        if ("takeProfit" in protection) {
            requestDescriptor.takeProfit = protection.takeProfit;
        }

        if ("trailingStopLoss" in protection) {
            requestDescriptor.trailingStopLoss = protection.trailingStopLoss;
        }

        const uuid: string = MidaUtilities.uuid();
        const protectionChangePromise: Promise<MidaBrokerPositionProtectionChange> = new Promise((resolver: Function) => {
            this.#protectionChangePendingRequests.set(uuid, [ protection, resolver, ]);
        });

        this.#sendCommand("ProtoOAAmendPositionSLTPReq", requestDescriptor, uuid);

        return protectionChangePromise;
    }

    // eslint-disable-next-line max-lines-per-function
    async #onUpdate (descriptor: GenericObject): Promise<void> {
        if (this.#updateEventIsLocked) {
            this.#updateEventQueue.push(descriptor);

            return;
        }

        this.#updateEventIsLocked = true;

        const plainOrder: GenericObject = descriptor.order;
        const positionId: string = plainOrder?.positionId?.toString();
        const messageId: string = descriptor.clientMsgId;

        if (positionId && positionId === this.id) {
            // Used to associate the order to the actual position
            if (!this.#hasOrder(plainOrder.orderId.toString())) {
                this.onOrder(await this.#cTraderBrokerAccount.normalizePlainOrder(plainOrder));
            }

            switch (descriptor.executionType) {
                case "SWAP": {
                    // TODO: pass the real quantity
                    this.onSwap(NaN);

                    break;
                }
                case "ORDER_ACCEPTED":
                case "ORDER_REPLACED": {
                    if (plainOrder.orderType === "STOP_LOSS_TAKE_PROFIT") {
                        this.onProtectionChange(this.#cTraderBrokerAccount.normalizePlainPositionProtection(descriptor.position));

                        const protectionChangeRequest: any[] | undefined = this.#protectionChangePendingRequests.get(messageId);

                        if (protectionChangeRequest) {
                            protectionChangeRequest[1]({
                                status: MidaBrokerPositionProtectionChangeStatus.SUCCEEDED,
                                requestedProtection: protectionChangeRequest[0],
                            });
                        }
                    }

                    break;
                }
                case "ORDER_PARTIAL_FILL":
                case "ORDER_FILLED": {
                    const order: CTraderBrokerOrder = await this.#cTraderBrokerAccount.normalizePlainOrder(plainOrder);

                    if (order.status !== MidaBrokerOrderStatus.EXECUTED) {
                        await order.on("execute");
                    }

                    this.onOrderExecute(order);

                    break;
                }
            }
        }

        // Process next event if there is any
        const nextDescriptor: GenericObject | undefined = this.#updateEventQueue.shift();
        this.#updateEventIsLocked = false;

        if (nextDescriptor) {
            this.#onUpdate(nextDescriptor);
        }
        else if (this.status === MidaBrokerPositionStatus.CLOSED) {
            // this.#removeEventsListeners();
        }
    }

    #configureListeners (): void {
        this.#updateEventUuid = this.#connection.on("ProtoOAExecutionEvent", ({ descriptor, }): void => {
            if (descriptor.ctidTraderAccountId.toString() === this.#cTraderBrokerAccountId) {
                this.#onUpdate(descriptor); // Not using await is intended
            }
        });
    }

    #hasOrder (id: string): boolean {
        for (const order of this.orders) {
            if (order.id === id) {
                return true;
            }
        }

        return false;
    }

    #removeEventsListeners (): void {
        if (this.#updateEventUuid) {
            this.#connection.removeEventListener(this.#updateEventUuid);

            this.#updateEventUuid = undefined;
        }
    }

    async #sendCommand (payloadType: string, parameters?: GenericObject, messageId?: string): Promise<GenericObject> {
        return this.#connection.sendCommand(payloadType, {
            ctidTraderAccountId: this.#cTraderBrokerAccountId,
            ...parameters ?? {},
        }, messageId);
    }
}
