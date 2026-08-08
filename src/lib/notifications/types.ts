export type NewOrderNotificationPayload = {
  orderNumber: string;
  publicReference: string;
  customerName: string;
  customerPhone: string;
  city: string;
  itemsSubtotal: string;
  itemsCount: number;
  adminOrderUrl: string;
  pickingSlipUrl: string;
};

export type NotificationResult = {
  provider: "email" | "whatsapp";
  sent: boolean;
  reason?: string;
};

export interface NotificationProvider {
  name: "email" | "whatsapp";
  isConfigured(): boolean;
  sendNewOrderNotification(payload: NewOrderNotificationPayload): Promise<NotificationResult>;
}
