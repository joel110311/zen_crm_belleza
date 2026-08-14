export type ClinicalService = {
    id: string;
    code: string;
    name: string;
    category: string;
    price: number;
};

export const TREATMENT_CATALOG: ClinicalService[] = [
    { id: "consulta", code: "OFT-001", name: "Consulta oftalmologica", category: "Consulta", price: 900 },
    { id: "refraccion", code: "OPT-001", name: "Optometria / refraccion", category: "Optica", price: 450 },
    { id: "oct_macula", code: "RET-001", name: "OCT macular", category: "Retina", price: 1500 },
    { id: "oct_nervio", code: "GLA-001", name: "OCT nervio optico", category: "Glaucoma", price: 1500 },
    { id: "campo_visual", code: "GLA-002", name: "Campo visual computarizado", category: "Glaucoma", price: 1200 },
    { id: "topografia", code: "COR-001", name: "Topografia corneal", category: "Cornea", price: 1100 },
    { id: "paquimetria", code: "COR-002", name: "Paquimetria corneal", category: "Cornea", price: 700 },
    { id: "retinografia", code: "RET-002", name: "Retinografia / fondo de ojo", category: "Retina", price: 900 },
    { id: "tonometria", code: "GLA-003", name: "Tonometria / curva tensional", category: "Glaucoma", price: 650 },
    { id: "biometria", code: "CIR-001", name: "Biometria ocular", category: "Cirugia", price: 1300 },
    { id: "catarata", code: "CIR-010", name: "Cirugia de catarata por ojo", category: "Cirugia", price: 28000 },
    { id: "pterigion", code: "CIR-020", name: "Cirugia de pterigion", category: "Cirugia", price: 15000 },
    { id: "laser", code: "RET-010", name: "Fotocoagulacion laser", category: "Retina", price: 5500 },
    { id: "inyeccion", code: "RET-020", name: "Inyeccion intravitrea", category: "Retina", price: 9000 },
    { id: "control", code: "OFT-002", name: "Control postoperatorio", category: "Consulta", price: 600 },
];
