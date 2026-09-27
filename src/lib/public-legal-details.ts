import "server-only";

/** Public operator contact details shown in legal notices. Environment values can override them per deployment. */
export const publicLegalDetails = {
    name: process.env.PUBLIC_LEGAL_NAME?.trim() || "Joel Venegas Vargas",
    address: process.env.PUBLIC_LEGAL_ADDRESS?.trim() || "Villa de Coss 118, Villas de Santa Julia, León, Guanajuato, C.P. 37530",
    phone: process.env.PUBLIC_SUPPORT_PHONE?.trim() || "+52 477 268 3928",
    privacyEmail: process.env.PUBLIC_PRIVACY_EMAIL?.trim() || "contacto@synapselogik.com",
    supportEmail: process.env.PUBLIC_SUPPORT_EMAIL?.trim() || "soporte@synapselogik.com",
};
