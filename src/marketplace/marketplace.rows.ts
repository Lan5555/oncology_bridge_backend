// PostgreSQL bigint columns are returned as strings by the driver.
export interface ActorRow {
  id: string;
  hospital_id: string;
  email: string;
  active: boolean;
  account_type: string | null;
  role_name: string;
  verification_status: string;
  facility_status: string;
  facility_deleted: Date | null;
  verified_record: boolean;
  can_list: boolean;
}
export interface BatchRow {
  id: string;
  hospital_id: string;
  medicine_id: string;
  quantity: number;
  status: string;
  valid_expiry: boolean;
  deleted_at: Date | null;
  selling_unit: string | null;
  storage_temperature: string;
  prescription_required: boolean;
  clinical_rx: boolean;
}
export interface ListingRow {
  id: string;
  inventory_item_id: string;
  facility_id: string;
  category: string;
  unit: string;
  price_kobo: string;
  quantity: number;
  description: string;
  storage: string;
  prescription_required: boolean;
  clinical_rx: boolean;
  medicine_id: string;
  generic_name: string;
  brand_name: string | null;
  strength: string | null;
  batch_number: string;
  expires_on: string;
  seller_name: string;
  city: string;
  available: number;
  images: { id: string; url: string; alt: string }[];
}
export interface PrescriptionRow {
  id: string;
  prescriber_id: string;
  pharmacy_facility_id: string;
  drug_id: string;
  qty: number;
  auth_status: string;
  order_stage: string;
}
export interface OrderRow {
  id: string;
  buyer_id: string;
  listing_id: string;
  inventory_item_id: string;
  facility_id: string;
  prescription_id: string | null;
  payload_hash: string;
  quantity: number;
  unit_price_kobo: string;
  total_kobo: string;
  payment_reference: string;
  invoice_reference: string;
  authorization_url: string | null;
  reservation_state: string;
  payment_status: string;
  fulfillment_state: string;
  expires_at: Date;
  initializationError?: unknown;
  snapshot: { name: string; prescriptionRequired: boolean };
}
