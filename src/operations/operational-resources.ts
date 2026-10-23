import { transferAvailableQuantity } from '../transfer_requests/transfer-availability';
import {
  storageReadingStateSql,
  validStorageLimits,
} from '../storage_units/reading-presentation';

export const READ_PERMISSIONS = {
  medicines: 'medicine.read',
  inventory: 'inventory.read',
  marketplace: 'marketplace.read',
  prescriptions: 'prescription.read',
  invoices: 'invoice.read',
  transfers: 'transfer.read',
  scans: 'scan.read',
  storage: 'coldchain.read',
  events: 'coldchain.read',
  expiry: 'inventory.read',
  network: 'network.read',
  research: 'research.read',
} as const;
export type OperationalResource = keyof typeof READ_PERMISSIONS;
export interface ReadDefinition {
  from: string;
  select: string;
  search: string;
  scope: (placeholder: string) => string;
  order: string;
  where?: string;
  networkOnly?: boolean;
}
const FACILITY =
  "jsonb_build_object('id',h.id,'name',h.name,'city',h.city,'state',h.state,'status',h.status)";
const MEDICINE =
  "jsonb_build_object('id',m.id,'generic_name',m.generic_name,'brand_name',m.brand_name,'strength',m.strength,'gtin',m.gtin,'storage_temperature',m.storage_temperature,'active',(m.deleted_at IS NULL),'deleted_at',m.deleted_at)";
// Shared by catalogue reads and manual intake authorization.
export const catalogueMedicineScope = (p: string) =>
  `(m.catalog_facility_id=${p} OR EXISTS(SELECT 1 FROM inventory owned WHERE owned.medicine_id=m.id AND owned.hospital_id=${p}))`;
const INVENTORY_FROM =
  'inventory i LEFT JOIN medicines m ON m.id=i.medicine_id JOIN hospitals h ON h.id=i.hospital_id';
const INVENTORY: ReadDefinition = {
  from: INVENTORY_FROM,
  select: `i.id,i.hospital_id,i.medicine_id,i.batch_number,i.serial_number,i.expiry_date,i.quantity,i.status,
    i.selling_unit,i.selling_unit unit,i.storage_unit_id,i.created_at,i.updated_at,${FACILITY} hospital,h.name facility,CASE WHEN m.id IS NULL THEN NULL ELSE ${MEDICINE} END medicine,
    CASE WHEN m.id IS NULL THEN 'UNLINKED' ELSE 'LINKED' END "linkageStatus",i.batch_number "batchNumber",
    (m.deleted_at IS NOT NULL) medicine_deleted,(m.id IS NOT NULL AND m.deleted_at IS NULL) medicine_active,
    m.generic_name drug,m.brand_name brand,m.gtin,i.batch_number lot,i.serial_number serial,i.quantity qty,
    i.expiry_date expiry,h.id "facilityId",h.name facility_name,
    ${transferAvailableQuantity('i')} "availableQuantity"`,
  search:
    "concat_ws(' ',m.generic_name,m.brand_name,m.gtin,i.batch_number,i.serial_number,h.name,h.city,i.status)",
  scope: (p) => `i.hospital_id=${p}`,
  order: 'i.created_at DESC,i.id ASC',
};

export const READ_DEFINITIONS: Record<OperationalResource, ReadDefinition> = {
  medicines: {
    from: 'medicines m LEFT JOIN hospitals h ON h.id=m.catalog_facility_id',
    select: `m.id,m.gtin,m.generic_name,m.brand_name,m.manufacturer,m.strength,m.dosage_form,m.storage_temperature,
      m.prescription_required,m.catalog_facility_id,m.created_at,m.deleted_at,
      CASE WHEN h.id IS NULL THEN NULL ELSE ${FACILITY} END facility`,
    search:
      "concat_ws(' ',m.generic_name,m.brand_name,m.gtin,m.manufacturer,m.strength,h.name)",
    scope: catalogueMedicineScope,
    order: 'm.generic_name ASC,m.id ASC',
    where: 'm.deleted_at IS NULL',
  },
  inventory: INVENTORY,
  expiry: { ...INVENTORY, order: 'i.expiry_date ASC,i.id ASC' },
  marketplace: {
    from: `marketplace_listings l JOIN inventory i ON i.id=l.inventory_item_id JOIN medicines m ON m.id=i.medicine_id JOIN hospitals h ON h.id=l.facility_id`,
    select: `l.id,l.inventory_item_id,l.inventory_item_id "inventoryItemId",l.facility_id,l.creator_id,l.category,l.unit,
      l.price_kobo,(l.price_kobo::numeric/100)::double precision "unitPriceNaira",l.quantity,l.description,l.storage,
      l.prescription_required,l.prescription_required "prescriptionRequired",l.status,l.created_at,
      m.generic_name name,m.brand_name brand,m.strength,i.batch_number "batchNumber",i.expiry_date "expiresOn",
      ${FACILITY} facility,${FACILITY} seller,${MEDICINE} medicine,
      jsonb_build_object('id',i.id,'quantity',i.quantity,'status',i.status,'batch_number',i.batch_number,'expiry_date',i.expiry_date) inventory,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',img.id,'url',img.url,'alt',img.alt,'position',img.position) ORDER BY img.position)
        FROM marketplace_listing_images img WHERE img.listing_id=l.id),'[]'::jsonb) images`,
    search:
      "concat_ws(' ',m.generic_name,m.brand_name,l.description,l.status,i.batch_number,h.name,h.city)",
    scope: (p) => `l.facility_id=${p}`,
    order: 'l.created_at DESC,l.id ASC',
    networkOnly: true,
  },
  prescriptions: {
    from: 'prescriptions p JOIN medicines m ON m.id=p.drug_id JOIN hospitals h ON h.id=p.pharmacy_facility_id LEFT JOIN users prescriber ON prescriber.id=p.prescriber_id',
    select: `p.id,p.display_id,p.patient_ref,p.drug_id,p.qty,p.icd10,p.description,p.tnm_stage,p.insurer,p.pharmacy_facility_id,
      p.auth_status,p.order_stage,p.prescriber_id,p.created_at,p.updated_at,${FACILITY} facility,
      ${FACILITY} pharmacy,h.name pharmacy_name,${MEDICINE} medicine,
      CASE WHEN prescriber.id IS NULL THEN NULL ELSE jsonb_build_object('id',prescriber.id,'name',concat_ws(' ',prescriber.first_name,prescriber.last_name)) END prescriber`,
    search:
      "concat_ws(' ',p.display_id,p.patient_ref,p.auth_status,p.order_stage,m.generic_name,m.brand_name,h.name)",
    scope: (p) => `p.pharmacy_facility_id=${p}`,
    order: 'p.created_at DESC,p.id ASC',
  },
  invoices: {
    from: `(SELECT inv.id,inv.reference,inv.order_id,inv.pharmacy_facility_id facility_id,inv.status,
      inv.total_naira::numeric total_naira,inv.paystack_reference,inv.paid_at,inv.created_at,
      NULL::uuid buyer_facility_id,'LEGACY'::text source,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',line.id,'description',line.description,'quantity',line.quantity,
        'unit_price_naira',line.unit_price_naira) ORDER BY line.id) FROM invoice_items line WHERE line.invoice_id=inv.id),'[]'::jsonb) items
      FROM invoices inv
      UNION ALL
      SELECT o.id,o.invoice_reference,o.id,o.facility_id,o.payment_status,o.total_kobo::numeric/100,o.payment_reference,
        o.paid_at,o.created_at,buyer.hospital_id,'MARKETPLACE'::text,
        jsonb_build_array(jsonb_build_object('description',o.snapshot->>'name','quantity',o.quantity,
          'unit_price_naira',o.unit_price_kobo::numeric/100,'medicineId',o.snapshot->>'medicineId'))
      FROM marketplace_orders o JOIN users buyer ON buyer.id=o.buyer_id) x JOIN hospitals h ON h.id=x.facility_id`,
    select: `x.id,x.reference,x.order_id,x.facility_id,x.facility_id pharmacy_facility_id,x.status,
      x.total_naira::double precision total_naira,x.total_naira::double precision "totalNaira",x.paystack_reference,
      x.paid_at,x.created_at,x.source,x.items,${FACILITY} facility`,
    search:
      "concat_ws(' ',x.reference,x.order_id::text,x.paystack_reference,x.status,h.name)",
    scope: (p) => `(x.facility_id=${p} OR x.buyer_facility_id=${p})`,
    order: 'x.created_at DESC,x.id ASC,x.source ASC',
  },
  transfers: {
    from: 'transfer_requests t JOIN medicines m ON m.id=t.medicine_id JOIN hospitals h ON h.id=t.from_hospital JOIN hospitals recipient ON recipient.id=t.to_hospital',
    select: `t.id,t.from_hospital,t.to_hospital,t.medicine_id,t.inventory_id,t.quantity,t.selling_unit unit,t.status,t.approved_at,t.created_at,
      ${FACILITY} "fromHospital",jsonb_build_object('id',recipient.id,'name',recipient.name,'city',recipient.city,'status',recipient.status) "toHospital",${MEDICINE} medicine,
      jsonb_build_object('id',t.inventory_id) inventory`,
    search:
      "concat_ws(' ',t.id::text,t.status,m.generic_name,m.brand_name,h.name,recipient.name)",
    scope: (p) => `(t.from_hospital=${p} OR t.to_hospital=${p})`,
    order: 't.created_at DESC,t.id ASC',
  },
  scans: {
    from: 'scan_logs s LEFT JOIN inventory i ON i.id=s.inventory_id LEFT JOIN medicines m ON m.id=i.medicine_id LEFT JOIN hospitals h ON h.id=COALESCE(s.facility_id,i.hospital_id)',
    select: `s.id,s.inventory_id,s.gtin,s.batch_number,s.serial_number,s.expiry_date,s.action,s.result,s.created_at,s.client_ts,
      s.batch_number lot,s.serial_number serial,s.expiry_date expiry,s.created_at at,
      ${FACILITY} facility,${MEDICINE} medicine,jsonb_build_object('id',s.scanned_by) "scannedBy"`,
    search:
      "concat_ws(' ',s.gtin,s.batch_number,s.serial_number,s.result,m.generic_name,m.brand_name,h.name)",
    scope: (p) => `COALESCE(s.facility_id,i.hospital_id)=${p}`,
    order: 's.created_at DESC,s.id ASC',
  },
  storage: {
    from: `storage_units unit JOIN hospitals h ON h.id=unit.facility_id LEFT JOIN LATERAL
      (SELECT r.temperature,r.recorded_at FROM temperature_logs r WHERE r.unit_id=unit.id AND r.recorded_at IS NOT NULL AND isfinite(r.recorded_at) ORDER BY r.recorded_at DESC,r.id DESC LIMIT 1) reading ON true`,
    select: `unit.id,unit.facility_id,unit.label,unit.kind,
      CASE WHEN ${validStorageLimits} THEN unit.target_min END target_min,
      CASE WHEN ${validStorageLimits} THEN unit.target_max END target_max,unit.offline_after_seconds,
      unit.operational_state,unit.last_seen_at,unit.created_at,${FACILITY} facility,
      CASE WHEN ${validStorageLimits} THEN unit.target_min::double precision END "targetMin",
      CASE WHEN ${validStorageLimits} THEN unit.target_max::double precision END "targetMax",
      CASE WHEN reading.recorded_at IS NOT NULL AND reading.temperature::text NOT IN ('NaN','Infinity','-Infinity') THEN reading.temperature::double precision END "currentC",reading.recorded_at "currentReadingAt",unit.last_seen_at "lastSeenAt",
      unit.offline_after_seconds "offlineAfterSeconds",
      ${storageReadingStateSql} "readingState"`,
    search:
      "concat_ws(' ',unit.label,unit.kind,unit.operational_state,h.name,h.city)",
    scope: (p) => `unit.facility_id=${p}`,
    order: 'unit.label ASC,unit.id ASC',
  },
  events: {
    from: 'cold_chain_events e JOIN storage_units unit ON unit.id=e.unit_id JOIN hospitals h ON h.id=unit.facility_id',
    select: `e.id,e.unit_id,e.unit_id "unitId",e.severity,e.message,e.action_taken,e.action_taken "actionTaken",e.state,e.state status,
      e.at,e.last_seen_at,e.last_seen_at "lastSeenAt",e.resolved_at,e.resolved_at "resolvedAt",
      e.observed_min_celsius,e.observed_max_celsius,e.affected_inventory_ids,
      e.observed_min_celsius::double precision "observedMinCelsius",e.observed_max_celsius::double precision "observedMaxCelsius",
      ${FACILITY} facility,jsonb_build_object('id',unit.id,'label',unit.label,'facility_id',unit.facility_id) unit`,
    search:
      "concat_ws(' ',e.severity,e.message,e.state,unit.label,h.name,h.city)",
    scope: (p) => `unit.facility_id=${p}`,
    order: 'e.at DESC,e.id ASC',
  },
  network: {
    from: 'hospitals h',
    select: `h.id,h.name,h.hospital_code,h.facility_type,h.facility_type type,h.status,h.address,h.city,h.state,
      h.latitude::double precision latitude,h.longitude::double precision longitude,
      h.latitude::double precision lat,h.longitude::double precision lng,(h.status='ACTIVE') online,(h.status<>'ACTIVE') alert,
      h.created_at,h.updated_at`,
    search:
      "concat_ws(' ',h.name,h.hospital_code,h.facility_type,h.status,h.city,h.state)",
    scope: (p) => `h.id=${p}`,
    order: 'h.name ASC,h.id ASC',
    where: 'h.deleted_at IS NULL',
  },
  research: {
    from: 'research_inquiries r',
    select: 'r.id,r.name,r.organisation,r.email,r.message,r.created_at',
    search: "concat_ws(' ',r.name,r.organisation,r.email,r.message)",
    scope: () => 'false',
    order: 'r.created_at DESC,r.id ASC',
    networkOnly: true,
  },
};
