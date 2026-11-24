export type Role = 'owner' | 'staff';
export type EstimateStatus = 'draft' | 'awaiting_signature' | 'signed' | 'issued' | 'void';
export type ProductType = 'test' | 'certificate' | 'labor' | 'parts' | 'dmv_fee' | 'other';

export interface Shop {
  id: string; name: string; street: string | null; city: string | null; state: string | null;
  zip: string | null; phone: string | null; ard_number: string | null; logo_path: string | null;
  tax_rate: number; google_review_url: string | null;
  review_trigger: 'signed' | 'paid' | 'first'; review_delay_minutes: number;
  public_app_url: string | null; has_staff_pin: boolean;
}

export interface Profile {
  id: string; shop_id: string; full_name: string; role: Role; is_technician: boolean; active: boolean;
}

export interface Product {
  id: string; code: string; description: string; product_type: ProductType;
  unit_cost: number; unit_price: number; taxable: boolean; track_inventory: boolean;
  on_hand: number; sort_order: number; active: boolean;
}

export interface NamedListItem { id: string; name: string; sort_order: number; active: boolean }
export interface PriceList extends NamedListItem { is_default: boolean }
export interface PriceListItem { id: string; price_list_id: string; product_id: string; unit_price: number }
export interface PaymentType extends NamedListItem {
  is_card: boolean; card_fee_percent: number; is_company_account: boolean;
}
export interface DiscountTerm extends NamedListItem { percent: number; amount: number }

export interface Company {
  id: string; name: string; contact_person: string | null; phone: string | null; email: string | null;
  street: string | null; unit: string | null; city: string | null; state: string | null; zip: string | null;
  notes: string | null; billing_mode: 'on_the_spot' | 'monthly'; active: boolean;
}

export interface Estimate {
  id: string; shop_id: string; estimate_number: string; manual_estimate_number: string | null;
  po_number: string | null; account_id: string; status: EstimateStatus;
  vehicle_id: string | null; plate: string | null; plate_none: boolean; plate_state: string | null;
  year: number | null; make: string | null; model: string | null;
  odometer: number | null; odometer_none: boolean; vin: string | null;
  customer_id: string | null; company_id: string | null;
  customer_first_name: string; customer_last_name: string;
  owner_first_name: string; owner_last_name: string; owner_same_as_customer: boolean;
  street: string | null; unit: string | null; zip: string | null; city: string | null; state: string | null;
  phone: string | null; email: string | null; registration_due_date: string | null;
  retest_of_invoice_number: string | null; retest_of_date: string | null;
  reason_for_test: string | null; referral_source_id: string | null; price_list_id: string | null;
  is_star: boolean; tire_pressure_check: string | null; notes: string | null;
  subtotal: number; subtotal_parts: number; subtotal_labor: number; state_certificate: number;
  dmv_fees: number; discount_total: number; tax: number; total: number;
  issued_at: string | null; time_in: string; time_out: string | null; result: 'PASS' | 'FAIL' | null;
  certificate_number: string | null; technician_id: string | null; bay: string | null;
  payment_type_id: string | null; amount_paid: number; change_due: number; card_fee_total: number;
  paid_at: string | null; billed_to_company: boolean; signature_id: string | null; sms_consent: boolean;
  pdf_path: string | null; print_count: number; voided_at: string | null; void_reason: string | null;
  created_by: string | null; created_at: string; updated_at: string;
}

export interface EstimateItem {
  id: string; estimate_id: string; line_no: number; product_id: string | null; product_code: string | null;
  product_type: ProductType; description: string; quantity: number; unit_cost: number; unit_price: number;
  price_overridden: boolean; taxable: boolean; discount_term_id: string | null; discount_amount: number;
  total_price: number;
}

export interface Payment {
  id: string; estimate_id: string; payment_type_id: string; amount: number; tendered: number | null;
  card_fee: number; reference: string | null; received_by: string | null; received_at: string;
}

export interface Signature {
  id: string; estimate_id: string; image_path: string; signer_name: string; signed_at: string;
  method: 'tablet' | 'remote';
}

export interface ReviewRequest {
  id: string; estimate_id: string; status: 'pending' | 'sent' | 'skipped' | 'failed';
  scheduled_for: string; channel: 'sms' | 'email' | null; sent_at: string | null;
  clicked_at: string | null; click_count: number; created_at: string;
}

export interface ActiveSession {
  id: string; user_id: string; device_label: string | null; user_agent: string | null;
  last_seen_at: string; revoked_at: string | null; created_at: string;
}

export interface AuditEntry {
  id: number; table_name: string; row_id: string; action: string; actor_id: string | null;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null; created_at: string;
}
