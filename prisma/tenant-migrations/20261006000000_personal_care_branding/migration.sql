-- Update product defaults without changing custom business names or public URLs.
ALTER TABLE "SystemSettings"
    ALTER COLUMN "brandName" SET DEFAULT 'Zen CRM Cuidado Personal',
    ALTER COLUMN "clinicName" SET DEFAULT 'Zen CRM Cuidado Personal',
    ALTER COLUMN "clinicSubtitle" SET DEFAULT 'Servicios de cuidado personal',
    ALTER COLUMN "doctorTitle" SET DEFAULT 'Profesional de cuidado personal',
    ALTER COLUMN "portalClinicName" SET DEFAULT 'Zen CRM Cuidado Personal',
    ALTER COLUMN "posTicketHeader" SET DEFAULT E'Zen CRM Cuidado Personal\nServicios de cuidado personal\nDireccion del negocio';

UPDATE "SystemSettings"
SET
    "brandName" = CASE WHEN "brandName" = 'Zen CRM Belleza' THEN 'Zen CRM Cuidado Personal' ELSE "brandName" END,
    "clinicName" = CASE WHEN "clinicName" = 'Zen CRM Belleza' THEN 'Zen CRM Cuidado Personal' ELSE "clinicName" END,
    "clinicSubtitle" = CASE WHEN "clinicSubtitle" = 'Servicios de belleza' THEN 'Servicios de cuidado personal' ELSE "clinicSubtitle" END,
    "doctorTitle" = CASE WHEN "doctorTitle" = 'Profesional de belleza' THEN 'Profesional de cuidado personal' ELSE "doctorTitle" END,
    "portalClinicName" = CASE WHEN "portalClinicName" = 'Zen CRM Belleza' THEN 'Zen CRM Cuidado Personal' ELSE "portalClinicName" END,
    "posTicketHeader" = CASE WHEN "posTicketHeader" = E'Zen CRM Belleza\nServicios de belleza\nDireccion del negocio' THEN E'Zen CRM Cuidado Personal\nServicios de cuidado personal\nDireccion del negocio' ELSE "posTicketHeader" END,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE
    "brandName" = 'Zen CRM Belleza'
    OR "clinicName" = 'Zen CRM Belleza'
    OR "clinicSubtitle" = 'Servicios de belleza'
    OR "doctorTitle" = 'Profesional de belleza'
    OR "portalClinicName" = 'Zen CRM Belleza'
    OR "posTicketHeader" = E'Zen CRM Belleza\nServicios de belleza\nDireccion del negocio';
