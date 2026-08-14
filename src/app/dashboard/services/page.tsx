import { getServicesCatalog } from "@/app/actions/services";
import { ServicesCatalog } from "@/components/services/services-catalog";

export default async function ServicesPage() {
    const catalog = await getServicesCatalog();
    return <ServicesCatalog initialData={catalog} />;
}
