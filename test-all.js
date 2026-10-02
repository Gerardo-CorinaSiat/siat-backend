const fetch = require('node-fetch');

async function run() {
    const catalogos = [
        'actividades',
        'fechaHora',
        'actividadesDocumentoSector',
        'leyendasFactura',
        'mensajesServicios',
        'productosServicios',
        'motivosAnulacion',
        'eventosSignificativos',
        'tiposDocumentoIdentidad',
        'tiposDocumentoSector',
        'tiposEmision',
        'tiposHabitacion',
        'tiposMetodoPago',
        'tiposMoneda',
        'tiposPuntoVenta',
        'tiposFactura',
        'unidadesMedida',
        'paisOrigen'
    ];

    for (let c of catalogos) {
        console.log("Testing:", c);
        try {
            const res = await fetch('http://localhost:3001/api/siat/catalogos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemCode: '586616654C39F91D686',
                    cuis: 'D8A4F004',
                    nit: '348190024',
                    tipoCatalogo: c,
                    delegatedToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJuaXQiOjM0ODE5MDAyNCwic3lzdGVtQ29kZSI6IjU4NUNFNjgyMTNDNEUzRThCODciLCJleHAiOjI1Mjk3NjMyMDB9.x' // Needs real token or it will fail
                })
            });
            const text = await res.text();
            console.log(text);
        } catch (e) {
            console.log("Error:", e.message);
        }
    }
}

run();
