ALTER TABLE "SystemSettings"
    ALTER COLUMN "brandName" SET DEFAULT 'Zen CRM Belleza',
    ALTER COLUMN "clinicName" SET DEFAULT 'Zen CRM Belleza',
    ALTER COLUMN "clinicSubtitle" SET DEFAULT 'Servicios de belleza',
    ALTER COLUMN "clinicAddress" SET DEFAULT 'Direccion del negocio',
    ALTER COLUMN "doctorTitle" SET DEFAULT 'Profesional de belleza',
    ALTER COLUMN "portalSlug" SET DEFAULT 'belleza',
    ALTER COLUMN "portalClinicName" SET DEFAULT 'Zen CRM Belleza',
    ALTER COLUMN "portalIntro" SET DEFAULT 'Aparta el horario para tu proximo servicio.',
    ALTER COLUMN "posTicketHeader" SET DEFAULT E'Zen CRM Belleza\nServicios de belleza\nDireccion del negocio';

UPDATE "SystemSettings"
SET
    "brandName" = CASE WHEN "brandName" = 'Zen CRM Oftalmo' THEN 'Zen CRM Belleza' ELSE "brandName" END,
    "clinicName" = CASE WHEN "clinicName" = 'Zen CRM Oftalmo' THEN 'Zen CRM Belleza' ELSE "clinicName" END,
    "clinicSubtitle" = CASE WHEN "clinicSubtitle" = 'Clinica oftalmologica' THEN 'Servicios de belleza' ELSE "clinicSubtitle" END,
    "clinicAddress" = CASE WHEN "clinicAddress" = 'Direccion de la clinica' THEN 'Direccion del negocio' ELSE "clinicAddress" END,
    "doctorTitle" = CASE WHEN "doctorTitle" = 'Medico Oftalmologo' THEN 'Profesional de belleza' ELSE "doctorTitle" END,
    "portalSlug" = CASE WHEN LOWER(COALESCE("portalSlug", '')) = 'oftalmo' THEN 'belleza' ELSE "portalSlug" END,
    "portalClinicName" = CASE WHEN "portalClinicName" = 'Zen CRM Oftalmo' THEN 'Zen CRM Belleza' ELSE "portalClinicName" END,
    "portalIntro" = CASE WHEN "portalIntro" = 'Agenda tu consulta oftalmologica y recibe confirmacion por WhatsApp.' THEN 'Aparta el horario para tu proximo servicio.' ELSE "portalIntro" END,
    "posTicketHeader" = CASE WHEN "posTicketHeader" = E'Zen CRM Oftalmo\nClinica oftalmologica\nDireccion de la clinica' THEN E'Zen CRM Belleza\nServicios de belleza\nDireccion del negocio' ELSE "posTicketHeader" END;
