const axios = require('axios');
const xml2js = require('xml2js');

const ENDPOINTS = {
    codigos: 'https://pilotosiatservicios.impuestos.gob.bo/sfd/FacturacionCodigos',
    sincronizacion: 'https://pilotosiatservicios.impuestos.gob.bo/sfd/FacturacionSincronizacion',
    operaciones: 'https://pilotosiatservicios.impuestos.gob.bo/sfd/FacturacionOperaciones',
    facturacion: 'https://pilotosiatservicios.impuestos.gob.bo/sfd/ServicioFacturacionCompraVenta',
    ajuste: 'https://pilotosiatservicios.impuestos.gob.bo/sfd/ServicioFacturacionDocumentoAjuste'
};

async function sendSoapRequest(xmlBody, endpoint, delegatedToken = '') {
    const maxRetries = 5;
    const retryDelayMs = 2000;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const apiHeader = delegatedToken ? (delegatedToken.trim().startsWith('TokenApi') ? delegatedToken.trim() : `TokenApi ${delegatedToken.trim()}`) : '';
            const response = await axios.post(endpoint, xmlBody, {
                headers: {
                    'Content-Type': 'text/xml;charset=UTF-8',
                    'SOAPAction': '',
                    'apikey': apiHeader
                },
                timeout: 30000
            });
            
            const parser = new xml2js.Parser({ 
                explicitArray: false, 
                ignoreAttrs: true,
                tagNameProcessors: [xml2js.processors.stripPrefix]
            });
            return await parser.parseStringPromise(response.data);
        } catch (error) {
            if (error.response && error.response.data) {
                try {
                    const parser = new xml2js.Parser({ 
                        explicitArray: false, 
                        ignoreAttrs: true,
                        tagNameProcessors: [xml2js.processors.stripPrefix]
                    });
                    return await parser.parseStringPromise(error.response.data);
                } catch (parseError) {}
            }
            if (attempt === maxRetries) {
                throw new Error(`Error conectando con SIAT V3 (${endpoint}): ${error.message}`);
            }
            await new Promise(res => setTimeout(res, retryDelayMs));
        }
    }
}

async function verificarComunicacion(delegatedToken) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:verificarComunicacion/>
   </soapenv:Body>
</soapenv:Envelope>`;

    const response = await sendSoapRequest(xml, ENDPOINTS.codigos, delegatedToken);
    const body = response?.Envelope?.Body?.verificarComunicacionResponse?.RespuestaComunicacion;
    if (body && body.transaccion === 'true') {
        return { success: true, mensaje: body.mensajesList ? body.mensajesList.descripcion : "Conexión Exitosa" };
    }
    return { success: false, mensaje: response?.Envelope?.Body?.Fault?.faultstring || "Error de comunicación" };
}

async function solicitarCuis(codigoSistema, nit, codigoAmbiente, codigoModalidad, codigoPuntoVenta, codigoSucursal, delegatedToken) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:cuis>
         <SolicitudCuis>
            <codigoAmbiente>${codigoAmbiente || 2}</codigoAmbiente>
            <codigoModalidad>${codigoModalidad || 2}</codigoModalidad>
            <codigoPuntoVenta>${codigoPuntoVenta || 0}</codigoPuntoVenta>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>${codigoSucursal || 0}</codigoSucursal>
            <nit>${nit}</nit>
         </SolicitudCuis>
      </ser:cuis>
   </soapenv:Body>
</soapenv:Envelope>`;

    const response = await sendSoapRequest(xml, ENDPOINTS.codigos, delegatedToken);
    if (response?.Envelope?.Body?.Fault) {
        return { success: false, mensaje: response.Envelope.Body.Fault.faultstring };
    }

    const body = response?.Envelope?.Body?.cuisResponse?.RespuestaCuis;
    if (body && (body.transaccion === 'true' || (body.transaccion === 'false' && body.mensajesList?.codigo === '980'))) {
        return {
            success: true,
            codigoCuis: body.codigo,
            fechaVigencia: body.fechaVigencia,
            mensaje: body.mensajesList ? body.mensajesList.descripcion : "CUIS obtenido con éxito."
        };
    }
    return { success: false, mensaje: body?.mensajesList?.descripcion || "Error obteniendo CUIS" };
}

async function solicitarCufd(codigoSistema, nit, cuis, codigoAmbiente, codigoModalidad, codigoPuntoVenta, codigoSucursal, delegatedToken) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:cufd>
         <SolicitudCufd>
            <codigoAmbiente>${codigoAmbiente || 2}</codigoAmbiente>
            <codigoModalidad>${codigoModalidad || 2}</codigoModalidad>
            <codigoPuntoVenta>${codigoPuntoVenta || 0}</codigoPuntoVenta>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>${codigoSucursal || 0}</codigoSucursal>
            <cuis>${cuis}</cuis>
            <nit>${nit}</nit>
         </SolicitudCufd>
      </ser:cufd>
   </soapenv:Body>
</soapenv:Envelope>`;

    const response = await sendSoapRequest(xml, ENDPOINTS.codigos, delegatedToken);
    if (response?.Envelope?.Body?.Fault) {
        return { success: false, mensaje: response.Envelope.Body.Fault.faultstring };
    }

    const body = response?.Envelope?.Body?.cufdResponse?.RespuestaCufd;
    if (body && body.transaccion === 'true') {
        return {
            success: true,
            codigoCufd: body.codigo,
            codigoControl: body.codigoControl,
            fechaVigencia: body.fechaVigencia,
            mensaje: "CUFD obtenido con éxito."
        };
    }
    return { success: false, mensaje: body?.mensajesList?.descripcion || "Error obteniendo CUFD" };
}

async function sincronizarCatalogos(codigoSistema, nit, cuis, codigoAmbiente, codigoSucursal, codigoPuntoVenta, tipoCatalogo, delegatedToken) {
    const catalogMap = {
        'actividades': 'sincronizarActividades',
        'fechaHora': 'sincronizarFechaHora',
        'actividadesDocumentoSector': 'sincronizarListaActividadesDocumentoSector',
        'leyendasFactura': 'sincronizarListaLeyendasFactura',
        'mensajesServicios': 'sincronizarListaMensajesServicios',
        'productosServicios': 'sincronizarListaProductosServicios',
        'motivosAnulacion': 'sincronizarParametricaMotivoAnulacion',
        'eventosSignificativos': 'sincronizarParametricaEventosSignificativos',
        'tiposDocumentoIdentidad': 'sincronizarParametricaTipoDocumentoIdentidad',
        'tiposDocumentoSector': 'sincronizarParametricaTipoDocumentoSector',
        'tiposEmision': 'sincronizarParametricaTipoEmision',
        'tiposHabitacion': 'sincronizarParametricaTipoHabitacion',
        'tiposMetodoPago': 'sincronizarParametricaTipoMetodoPago',
        'tiposMoneda': 'sincronizarParametricaTipoMoneda',
        'tiposPuntoVenta': 'sincronizarParametricaTipoPuntoVenta',
        'tiposFactura': 'sincronizarParametricaTiposFactura',
        'unidadesMedida': 'sincronizarParametricaUnidadMedida',
        'paisOrigen': 'sincronizarParametricaPaisOrigen'
    };

    const metodoSoap = catalogMap[tipoCatalogo] || tipoCatalogo;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:${metodoSoap}>
         <SolicitudSincronizacion>
            <codigoAmbiente>${codigoAmbiente || 2}</codigoAmbiente>
            <codigoPuntoVenta>${codigoPuntoVenta || 0}</codigoPuntoVenta>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>${codigoSucursal || 0}</codigoSucursal>
            <cuis>${cuis}</cuis>
            <nit>${nit}</nit>
         </SolicitudSincronizacion>
      </ser:${metodoSoap}>
   </soapenv:Body>
</soapenv:Envelope>`;

    const response = await sendSoapRequest(xml, ENDPOINTS.sincronizacion, delegatedToken);
    if (response?.Envelope?.Body?.Fault) {
        return { success: false, mensaje: response.Envelope.Body.Fault.faultstring };
    }

    const responseBody = response?.Envelope?.Body?.[`${metodoSoap}Response`];
    const trans = responseBody?.RespuestaListaParametricas?.transaccion 
               || responseBody?.RespuestaListaActividades?.transaccion
               || responseBody?.RespuestaListaProductos?.transaccion 
               || responseBody?.RespuestaFechaHora?.transaccion;

    return {
        success: trans === 'true',
        raw: responseBody
    };
}

module.exports = {
    ENDPOINTS,
    sendSoapRequest,
    verificarComunicacion,
    solicitarCuis,
    solicitarCufd,
    sincronizarCatalogos
};
