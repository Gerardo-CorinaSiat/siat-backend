const axios = require('axios');
const xml2js = require('xml2js');

const WSDL_CODIGOS = "https://pilotosiatservicios.impuestos.gob.bo/v2/FacturacionCodigos?wsdl";
const ENDPOINT_CODIGOS = "https://pilotosiatservicios.impuestos.gob.bo/v2/FacturacionCodigos";
const ENDPOINT_COMPUTARIZADA = "https://pilotosiatservicios.impuestos.gob.bo/v2/ServicioFacturacionComputarizada";
const ENDPOINT_OPERACIONES = "https://pilotosiatservicios.impuestos.gob.bo/v2/FacturacionOperaciones";
const ENDPOINT_COMPRAS = "https://pilotosiatservicios.impuestos.gob.bo/v2/ServicioRecepcionCompras";

/**
 * Función genérica para enviar peticiones SOAP al SIAT
 */
async function sendSoapRequest(xmlBody, endpoint, delegatedToken = '') {
    const maxRetries = 10;
    const retryDelayMs = 5000;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const apiHeader = delegatedToken ? (delegatedToken.trim().startsWith('TokenApi') ? delegatedToken.trim() : `TokenApi ${delegatedToken.trim()}`) : '';
            const response = await axios.post(endpoint, xmlBody, {
                headers: {
                    'Content-Type': 'text/xml;charset=UTF-8',
                    'SOAPAction': '',
                    'apikey': apiHeader
                },
                timeout: 120000
            });
            
            // Parsear la respuesta XML a objeto JS
            const parser = new xml2js.Parser({ 
                explicitArray: false, 
                ignoreAttrs: true,
                tagNameProcessors: [xml2js.processors.stripPrefix]
            });
            const result = await parser.parseStringPromise(response.data);
            return result;
        } catch (error) {
            if (error.response && error.response.data) {
                console.warn("SIAT devolvio un codigo HTTP de error. Intentando parsear SOAP Fault...");
                try {
                    const parser = new xml2js.Parser({ 
                        explicitArray: false, 
                        ignoreAttrs: true,
                        tagNameProcessors: [xml2js.processors.stripPrefix]
                    });
                    return await parser.parseStringPromise(error.response.data);
                } catch (parseError) {
                    console.error("Error al parsear el SOAP Fault:", parseError);
                }
            }
            
            console.error("Error de red o conexion al SIAT (Intento $attempt/$maxRetries):", error.message);
            if (attempt === maxRetries) {
                throw new Error("Error conectando con los servidores del SIAT tras multiples reintentos.");
            }
            console.log("Reintentando en $($retryDelayMs / 1000) segundos...");
            await new Promise(res => setTimeout(res, retryDelayMs));
        }
    }
}

/**
 * Verificar Comunicación (Ping)
 */
async function verificarComunicacion(delegatedToken) {
    // El sobre SOAP exacto que pide el SIN para el Ping
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:verificarComunicacion/>
   </soapenv:Body>
</soapenv:Envelope>`;

    const response = await sendSoapRequest(xml, ENDPOINT_CODIGOS, delegatedToken);
    
    // Check if it's a SOAP Fault
    if (response?.Envelope?.Body?.Fault) {
        console.error("Respuesta SIAT Ping (SOAP Fault):", JSON.stringify(response.Envelope.Body.Fault));
        return { 
            success: false, 
            mensaje: response.Envelope.Body.Fault.faultstring || "Error de validación del SIAT al hacer Ping."
        };
    }

    // Parseo de la respuesta (sin prefijos)
    const body = response?.Envelope?.Body?.verificarComunicacionResponse?.RespuestaComunicacion;
    
    if (body && body.transaccion === 'true') {
        return { success: true, mensaje: body.mensajesList ? body.mensajesList.descripcion : "Conexión Exitosa" };
    } else {
        console.error("Respuesta SIAT Ping fallida:", JSON.stringify(response));
        return { success: false, mensaje: "El SIAT reporta error de transacción o formato incorrecto." };
    }
}

/**
 * Solicitar CUIS
 */
async function solicitarCuis(codigoSistema, nit, codigoAmbiente, codigoModalidad, codigoPuntoVenta, codigoSucursal, delegatedToken) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:cuis>
         <SolicitudCuis>
            <codigoAmbiente>${codigoAmbiente}</codigoAmbiente>
            <codigoModalidad>${codigoModalidad}</codigoModalidad>
            <codigoPuntoVenta>${codigoPuntoVenta}</codigoPuntoVenta>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>${codigoSucursal}</codigoSucursal>
            <nit>${nit}</nit>
         </SolicitudCuis>
      </ser:cuis>
   </soapenv:Body>
</soapenv:Envelope>`;

    console.log("Enviando petición SOAP para CUIS hacia SIAT...", { codigoSistema, nit });
    const response = await sendSoapRequest(xml, ENDPOINT_CODIGOS, delegatedToken);
    
    // Check if it's a SOAP Fault
    if (response?.Envelope?.Body?.Fault) {
        console.error("Respuesta SIAT CUIS (SOAP Fault):", JSON.stringify(response.Envelope.Body.Fault));
        return { 
            success: false, 
            mensaje: response.Envelope.Body.Fault.faultstring || "Error de autorización o validación del SIAT."
        };
    }

    const body = response?.Envelope?.Body?.cuisResponse?.RespuestaCuis;
    
    if (body && (body.transaccion === 'true' || (body.transaccion === 'false' && body.mensajesList?.codigo === '980'))) {
        return {
            success: true,
            codigoCuis: body.codigo,
            fechaVigencia: body.fechaVigencia,
            mensaje: body.mensajesList ? body.mensajesList.descripcion : "CUIS obtenido con éxito."
        };
    } else {
        console.error("Respuesta SIAT CUIS fallida:", JSON.stringify(response));
        return { 
            success: false, 
            mensaje: body?.mensajesList?.descripcion || "El SIAT reporta error de transacción al obtener CUIS." 
        };
    }
}

/**
 * Solicitar CUFD (Código Único de Facturación Diaria)
 */
async function solicitarCufd(codigoSistema, nit, cufeOrCuis, codigoAmbiente, codigoModalidad, codigoPuntoVenta, codigoSucursal, delegatedToken) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:cufd>
         <SolicitudCufd>
            <codigoAmbiente>${codigoAmbiente}</codigoAmbiente>
            <codigoModalidad>${codigoModalidad}</codigoModalidad>
            <codigoPuntoVenta>${codigoPuntoVenta}</codigoPuntoVenta>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>${codigoSucursal}</codigoSucursal>
            <cuis>${cufeOrCuis}</cuis>
            <nit>${nit}</nit>
         </SolicitudCufd>
      </ser:cufd>
   </soapenv:Body>
</soapenv:Envelope>`;

    console.log("Enviando petición SOAP para CUFD hacia SIAT...", { codigoSistema, nit, cuis: cufeOrCuis });
    const response = await sendSoapRequest(xml, ENDPOINT_CODIGOS, delegatedToken);
    
    // Check if it's a SOAP Fault
    if (response?.Envelope?.Body?.Fault) {
        console.error("Respuesta SIAT CUFD (SOAP Fault):", JSON.stringify(response.Envelope.Body.Fault));
        return { 
            success: false, 
            mensaje: response.Envelope.Body.Fault.faultstring || "Error de autorización o validación del SIAT."
        };
    }

    const body = response?.Envelope?.Body?.cufdResponse?.RespuestaCufd;
    
    if (body && body.transaccion === 'true') {
        return {
            success: true,
            codigoCufd: body.codigo,
            codigoControl: body.codigoControl,
            fechaVigencia: body.fechaVigencia,
            mensaje: body.mensajesList ? body.mensajesList.descripcion : "CUFD obtenido con éxito."
        };
    } else {
        console.error("Respuesta SIAT CUFD fallida:", JSON.stringify(response));
        return { 
            success: false, 
            mensaje: body?.mensajesList?.descripcion || "El SIAT reporta error de transacción al obtener CUFD." 
        };
    }
}

/**
 * Recepción Factura Computarizada en Línea
 */
async function recepcionFacturaComputarizada(codigoSistema, nit, cuis, cufd, codigoAmbiente, codigoModalidad, codigoPuntoVenta, codigoSucursal, archivo, hashArchivo, fechaEnvio, codigoDocumentoSector, codigoEmision, tipoFacturaDocumento, delegatedToken) {
    let endpoint = ENDPOINT_COMPUTARIZADA;
    let metodo = 'recepcionFactura';
    let solicitud = 'SolicitudServicioRecepcionFactura';
    
    if (codigoDocumentoSector == 24 || codigoDocumentoSector == 47) {
        endpoint = "https://pilotosiatservicios.impuestos.gob.bo/v2/ServicioFacturacionDocumentoAjuste";
        metodo = 'recepcionDocumentoAjuste';
        solicitud = 'SolicitudServicioRecepcionDocumentoAjuste';
    } else if (codigoDocumentoSector == 23 || codigoDocumentoSector == 34) {
        endpoint = "https://pilotosiatservicios.impuestos.gob.bo/v2/ServicioFacturacionComputarizada";
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:${metodo}>
         <${solicitud}>
            <codigoAmbiente>${codigoAmbiente}</codigoAmbiente>
            <codigoDocumentoSector>${codigoDocumentoSector}</codigoDocumentoSector>
            <codigoEmision>${codigoEmision}</codigoEmision>
            <codigoModalidad>${codigoModalidad}</codigoModalidad>
            <codigoPuntoVenta>${codigoPuntoVenta}</codigoPuntoVenta>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>${codigoSucursal}</codigoSucursal>
            <cufd>${cufd}</cufd>
            <cuis>${cuis}</cuis>
            <nit>${nit}</nit>
            <tipoFacturaDocumento>${tipoFacturaDocumento}</tipoFacturaDocumento>
            <archivo>${archivo}</archivo>
            <fechaEnvio>${fechaEnvio}</fechaEnvio>
            <hashArchivo>${hashArchivo}</hashArchivo>
         </${solicitud}>
      </ser:${metodo}>
   </soapenv:Body>
</soapenv:Envelope>`;

    console.log(`Enviando documento (Sector ${codigoDocumentoSector}) hacia SIAT en endpoint: ${endpoint}`);
    const response = await sendSoapRequest(xml, endpoint, delegatedToken);
    
    if (response?.Envelope?.Body?.Fault) {
        console.error("Respuesta SIAT Recepcion (SOAP Fault):", JSON.stringify(response.Envelope.Body.Fault));
        return { 
            success: false, 
            mensaje: response.Envelope.Body.Fault.faultstring || "Error de validación del SIAT."
        };
    }

    const body = response?.Envelope?.Body?.recepcionFacturaResponse?.RespuestaServicioFacturacion
              || response?.Envelope?.Body?.recepcionDocumentoAjusteResponse?.RespuestaServicioFacturacion;
    
    if (body && (String(body.codigoEstado) === '908' || body.transaccion === 'true' || body.transaccion === true)) { // 908 = VALIDADA
        return {
            success: true,
            codigoRecepcion: body.codigoRecepcion,
            codigoEstado: String(body.codigoEstado || '908'),
            mensaje: "Factura VALIDADA por el SIN."
        };
    } else {
        console.error("Respuesta SIAT Recepcion fallida:", JSON.stringify(response));
        return { 
            success: false, 
            codigoEstado: body?.codigoEstado,
            mensaje: body?.mensajesList?.descripcion || "Factura rechazada u observada por el SIN." 
        };
    }
}

/**
 * Recepción de Documento Ajuste (Nota Crédito-Débito)
 */
async function recepcionDocumentoAjuste(codigoSistema, nit, cuis, cufd, codigoAmbiente, codigoModalidad, codigoPuntoVenta, codigoSucursal, archivo, hashArchivo, fechaEnvio, codigoDocumentoSector, codigoEmision, tipoFacturaDocumento, delegatedToken) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:recepcionDocumentoAjuste>
         <SolicitudServicioRecepcionDocumentoAjuste>
            <codigoAmbiente>${codigoAmbiente}</codigoAmbiente>
            <codigoDocumentoSector>${codigoDocumentoSector}</codigoDocumentoSector>
            <codigoEmision>${codigoEmision}</codigoEmision>
            <codigoModalidad>${codigoModalidad}</codigoModalidad>
            <codigoPuntoVenta>${codigoPuntoVenta}</codigoPuntoVenta>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>${codigoSucursal}</codigoSucursal>
            <cufd>${cufd}</cufd>
            <cuis>${cuis}</cuis>
            <nit>${nit}</nit>
            <tipoFacturaDocumento>${tipoFacturaDocumento}</tipoFacturaDocumento>
            <archivo>${archivo}</archivo>
            <fechaEnvio>${fechaEnvio}</fechaEnvio>
            <hashArchivo>${hashArchivo}</hashArchivo>
         </SolicitudServicioRecepcionDocumentoAjuste>
      </ser:recepcionDocumentoAjuste>
   </soapenv:Body>
</soapenv:Envelope>`;

    console.log("Enviando Documento de Ajuste hacia SIAT...");
    const response = await sendSoapRequest(xml, "https://pilotosiatservicios.impuestos.gob.bo/v2/ServicioFacturacionDocumentoAjuste", delegatedToken);
    
    if (response?.Envelope?.Body?.Fault) {
        console.error("Respuesta SIAT Recepcion Ajuste (SOAP Fault):", JSON.stringify(response.Envelope.Body.Fault));
        return { 
            success: false, 
            mensaje: response.Envelope.Body.Fault.faultstring || "Error de validación del SIAT."
        };
    }

    const body = response?.Envelope?.Body?.recepcionDocumentoAjusteResponse?.RespuestaServicioFacturacion;
    
    if (body && body.codigoEstado === '908') { // 908 = VALIDADA
        return {
            success: true,
            codigoRecepcion: body.codigoRecepcion,
            codigoEstado: body.codigoEstado,
            mensaje: "Documento de Ajuste VALIDADO por el SIN."
        };
    } else {
        console.error("Respuesta SIAT Recepcion Ajuste fallida:", JSON.stringify(response));
        return { 
            success: false, 
            codigoEstado: body?.codigoEstado,
            mensaje: body?.mensajesList?.descripcion || "Documento rechazado u observado por el SIN." 
        };
    }
}

const ENDPOINT_SINCRONIZACION = "https://pilotosiatservicios.impuestos.gob.bo/v2/FacturacionSincronizacion";

/**
 * Sincronizar Catálogos (Ej. Métodos de Pago, Actividades, Leyendas)
 */
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

    let metodoSoap = catalogMap[tipoCatalogo] || 'sincronizarParametricaTipoMetodoPago';

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

    console.log(`Enviando sincronización ${tipoCatalogo} hacia SIAT... con método ${metodoSoap}`);
    const response = await sendSoapRequest(xml, ENDPOINT_SINCRONIZACION, delegatedToken);
    
    if (tipoCatalogo === 'productosServicios' || tipoCatalogo === 'actividades') {
        console.log(`Respuesta SIAT para ${tipoCatalogo}:`, JSON.stringify(response));
    }

    if (response?.Envelope?.Body?.Fault) {
        console.error(`Fault en ${tipoCatalogo}:`, response.Envelope.Body.Fault.faultstring);
        return { success: false, mensaje: response.Envelope.Body.Fault.faultstring || "Error sincronizando catálogo." };
    }

    const responseBody = response?.Envelope?.Body?.[`${metodoSoap}Response`];
    let dataList = responseBody?.RespuestaListaParametricas?.listaCodigos 
                || responseBody?.RespuestaListaActividades?.listaActividades
                || responseBody?.RespuestaListaProductos?.listaCodigos 
                || responseBody?.RespuestaFechaHora?.fechaHora 
                || [];

    try {
        const fs = require('fs');
        fs.writeFileSync(`last_catalog_${tipoCatalogo}.json`, JSON.stringify(response, null, 2));
    } catch(e) {}

    return { 
        success: true, 
        mensaje: "Catálogo sincronizado exitosamente con el SIN.",
        data: Array.isArray(dataList) ? dataList : [dataList] // Ensure it's an array
    };
}

/**
 * Anulación de Factura Computarizada en Línea
 */
async function anulacionFactura(codigoSistema, nit, cuis, cufd, cuf, codigoMotivo, pv, delegatedToken, tipoFacturaDocumento = 1, codigoDocumentoSector = 1) {
    let endpoint = ENDPOINT_COMPUTARIZADA;
    let metodo = 'anulacionFactura';
    let solicitud = 'SolicitudServicioAnulacionFactura';
    
    if (codigoDocumentoSector == 24 || codigoDocumentoSector == 47) {
        endpoint = "https://pilotosiatservicios.impuestos.gob.bo/v2/ServicioFacturacionDocumentoAjuste";
        metodo = 'anulacionDocumentoAjuste';
        solicitud = 'SolicitudServicioAnulacionDocumentoAjuste';
    } else if (codigoDocumentoSector == 23 || codigoDocumentoSector == 34) {
        endpoint = "https://pilotosiatservicios.impuestos.gob.bo/v2/ServicioFacturacionComputarizada";
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:${metodo}>
         <${solicitud}>
            <codigoAmbiente>2</codigoAmbiente>
            <codigoDocumentoSector>${codigoDocumentoSector}</codigoDocumentoSector>
            <codigoEmision>1</codigoEmision>
            <codigoModalidad>2</codigoModalidad>
            <codigoMotivo>${codigoMotivo || 1}</codigoMotivo>
            <codigoPuntoVenta>${pv}</codigoPuntoVenta>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>0</codigoSucursal>
            <cufd>${cufd}</cufd>
            <cuis>${cuis}</cuis>
            <cuf>${cuf}</cuf>
            <nit>${nit}</nit>
            <tipoFacturaDocumento>${tipoFacturaDocumento}</tipoFacturaDocumento>
         </${solicitud}>
      </ser:${metodo}>
   </soapenv:Body>
</soapenv:Envelope>`;

    console.log(`Enviando anulación hacia SIAT (${metodo})...`, { cuf });
    const response = await sendSoapRequest(xml, endpoint, delegatedToken);
    
    if (response?.Envelope?.Body?.Fault) {
        return { success: false, mensaje: response.Envelope.Body.Fault.faultstring || "Error en anulación." };
    }

    const body = response?.Envelope?.Body?.[`${metodo}Response`]?.RespuestaServicioFacturacion
              || response?.Envelope?.Body?.anulacionFacturaResponse?.RespuestaServicioFacturacion
              || response?.Envelope?.Body?.anulacionDocumentoAjusteResponse?.RespuestaServicioFacturacion;
    if (body && (body.transaccion === 'true' || body.transaccion === true || String(body.codigoEstado) === '905')) {
        return { success: true, mensaje: "Factura Anulada correctamente en el SIN." };
    }
    return { success: false, mensaje: body?.mensajesList?.descripcion || "Respuesta no exitosa al anular." };
}

async function reversionAnulacionFactura(codigoSistema, nit, cuis, cufd, cuf, pv, delegatedToken, tipoFacturaDocumento = 1, codigoDocumentoSector = 1) {
    let endpoint = ENDPOINT_COMPUTARIZADA;
    let metodo = 'reversionAnulacionFactura';
    let solicitud = 'SolicitudServicioReversionAnulacionFactura';
    
    if (codigoDocumentoSector == 24 || codigoDocumentoSector == 47) {
        endpoint = "https://pilotosiatservicios.impuestos.gob.bo/v2/ServicioFacturacionDocumentoAjuste";
        metodo = 'reversionAnulacionDocumentoAjuste';
        solicitud = 'SolicitudServicioReversionAnulacionDocumentoAjuste';
    } else if (codigoDocumentoSector == 23 || codigoDocumentoSector == 34) {
        endpoint = "https://pilotosiatservicios.impuestos.gob.bo/v2/ServicioFacturacionComputarizada";
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:${metodo}>
         <${solicitud}>
            <codigoAmbiente>2</codigoAmbiente>
            <codigoDocumentoSector>${codigoDocumentoSector}</codigoDocumentoSector>
            <codigoEmision>1</codigoEmision>
            <codigoModalidad>2</codigoModalidad>
            <codigoPuntoVenta>${pv}</codigoPuntoVenta>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>0</codigoSucursal>
            <cufd>${cufd}</cufd>
            <cuis>${cuis}</cuis>
            <cuf>${cuf}</cuf>
            <nit>${nit}</nit>
            <tipoFacturaDocumento>${tipoFacturaDocumento}</tipoFacturaDocumento>
         </${solicitud}>
      </ser:${metodo}>
   </soapenv:Body>
</soapenv:Envelope>`;

    console.log(`Enviando reversion de anulación hacia SIAT (${metodo})...`, { cuf });
    const response = await sendSoapRequest(xml, endpoint, delegatedToken);
    
    if (response?.Envelope?.Body?.Fault) {
        return { success: false, mensaje: response.Envelope.Body.Fault.faultstring || "Error en reversion." };
    }

    const body = response?.Envelope?.Body?.[`${metodo}Response`]?.RespuestaServicioFacturacion
              || response?.Envelope?.Body?.reversionAnulacionFacturaResponse?.RespuestaServicioFacturacion
              || response?.Envelope?.Body?.reversionAnulacionDocumentoAjusteResponse?.RespuestaServicioFacturacion;
    if (body && (body.transaccion === 'true' || body.transaccion === true || String(body.codigoEstado) === '905' || String(body.codigoEstado) === '908' || String(body.codigoEstado) === '906')) {
        return { success: true, mensaje: "Factura Revertida correctamente en el SIN." };
    }
    return { success: false, mensaje: body?.mensajesList?.descripcion || "Respuesta no exitosa al revertir." };
}

async function registroEventoSignificativo(codigoSistema, nit, cuis, cufd, cufdEvento, codigoPuntoVenta, codigoSucursal, codigoMotivoEvento, descripcion, fechaHoraInicioEvento, fechaHoraFinEvento, delegatedToken) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:registroEventoSignificativo>
         <SolicitudEventoSignificativo>
            <codigoAmbiente>2</codigoAmbiente>
            <codigoMotivoEvento>${codigoMotivoEvento}</codigoMotivoEvento>
            <codigoPuntoVenta>${codigoPuntoVenta}</codigoPuntoVenta>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>${codigoSucursal}</codigoSucursal>
            <cufd>${cufd}</cufd>
            <cufdEvento>${cufdEvento}</cufdEvento>
            <cuis>${cuis}</cuis>
            <descripcion>${descripcion}</descripcion>
            <fechaHoraFinEvento>${fechaHoraFinEvento}</fechaHoraFinEvento>
            <fechaHoraInicioEvento>${fechaHoraInicioEvento}</fechaHoraInicioEvento>
            <nit>${nit}</nit>
         </SolicitudEventoSignificativo>
      </ser:registroEventoSignificativo>
   </soapenv:Body>
</soapenv:Envelope>`;

    console.log("Enviando evento significativo hacia SIAT...");
    const response = await sendSoapRequest(xml, ENDPOINT_OPERACIONES, delegatedToken);
    
    if (response?.Envelope?.Body?.Fault) {
        return { success: false, mensaje: response.Envelope.Body.Fault.faultstring || "Error en registro de evento." };
    }

    const body = response?.Envelope?.Body?.registroEventoSignificativoResponse?.RespuestaListaEventos;
    if (body && body.transaccion === 'true') {
        return { success: true, codigoRecepcionEventoSignificativo: body.codigoRecepcionEventoSignificativo, mensaje: "Evento registrado correctamente." };
    }
    console.log("DEBUG SIAT Evento:", JSON.stringify(body));
    return { success: false, mensaje: body?.mensajesList?.descripcion || JSON.stringify(body?.mensajesList) || "Respuesta no exitosa al registrar evento." };
}

async function recepcionPaqueteFactura(codigoSistema, nit, cuis, cufd, codigoPuntoVenta, codigoSucursal, archivo, hashArchivo, fechaEnvio, codigoDocumentoSector, codigoEmision, tipoFacturaDocumento, cantidadFacturas, codigoEvento, cafc, delegatedToken) {
    let eventoXml = codigoEvento ? `<codigoEvento>${codigoEvento}</codigoEvento>` : `<codigoEvento xsi:nil="true"/>`;
    let cafcXml = cafc ? `<cafc>${cafc}</cafc>` : `<cafc xsi:nil="true"/>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:recepcionPaqueteFactura>
         <SolicitudServicioRecepcionPaquete>
            <codigoAmbiente>2</codigoAmbiente>
            <codigoDocumentoSector>${codigoDocumentoSector}</codigoDocumentoSector>
            <codigoEmision>${codigoEmision}</codigoEmision>
            <codigoModalidad>2</codigoModalidad>
            <codigoPuntoVenta>${codigoPuntoVenta}</codigoPuntoVenta>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>${codigoSucursal}</codigoSucursal>
            <cufd>${cufd}</cufd>
            <cuis>${cuis}</cuis>
            <nit>${nit}</nit>
            <tipoFacturaDocumento>${tipoFacturaDocumento}</tipoFacturaDocumento>
            <archivo>${archivo}</archivo>
            <fechaEnvio>${fechaEnvio}</fechaEnvio>
            <hashArchivo>${hashArchivo}</hashArchivo>
            ${cafcXml}
            <cantidadFacturas>${cantidadFacturas}</cantidadFacturas>
            ${eventoXml}
         </SolicitudServicioRecepcionPaquete>
      </ser:recepcionPaqueteFactura>
   </soapenv:Body>
</soapenv:Envelope>`;

    console.log("Enviando paquete de facturas hacia SIAT...");
    const endpointToUse = (codigoDocumentoSector == 35 || codigoDocumentoSector == 1) ? 'https://pilotosiatservicios.impuestos.gob.bo/v2/ServicioFacturacionCompraVenta' : ENDPOINT_COMPUTARIZADA;
    const response = await sendSoapRequest(xml, endpointToUse, delegatedToken);
    
    if (response?.Envelope?.Body?.Fault) {
        return { success: false, mensaje: response.Envelope.Body.Fault.faultstring || "Error en envio de paquete." };
    }

    const body = response?.Envelope?.Body?.recepcionPaqueteFacturaResponse?.RespuestaServicioFacturacion;
    if (body && body.transaccion === 'true') {
        return { success: true, codigoRecepcion: body.codigoRecepcion, mensaje: "Paquete recibido correctamente." };
    }
    console.error("DEBUG SIAT recepcionPaqueteFactura FAIL:", JSON.stringify(body));
    return { success: false, mensaje: body?.mensajesList?.descripcion || JSON.stringify(body?.mensajesList) || "Respuesta no exitosa al enviar paquete." };
}

async function recepcionMasivaFactura(codigoSistema, nit, cuis, cufd, codigoPuntoVenta, codigoSucursal, archivo, hashArchivo, fechaEnvio, codigoDocumentoSector, codigoEmision, tipoFacturaDocumento, cantidadFacturas, delegatedToken) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:recepcionMasivaFactura>
         <SolicitudServicioRecepcionMasiva>
            <codigoAmbiente>2</codigoAmbiente>
            <codigoDocumentoSector>${codigoDocumentoSector}</codigoDocumentoSector>
            <codigoEmision>${codigoEmision}</codigoEmision>
            <codigoModalidad>2</codigoModalidad>
            <codigoPuntoVenta>${codigoPuntoVenta}</codigoPuntoVenta>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>${codigoSucursal}</codigoSucursal>
            <cufd>${cufd}</cufd>
            <cuis>${cuis}</cuis>
            <nit>${nit}</nit>
            <tipoFacturaDocumento>${tipoFacturaDocumento}</tipoFacturaDocumento>
            <archivo>${archivo}</archivo>
            <fechaEnvio>${fechaEnvio}</fechaEnvio>
            <hashArchivo>${hashArchivo}</hashArchivo>
            <cantidadFacturas>${cantidadFacturas}</cantidadFacturas>
         </SolicitudServicioRecepcionMasiva>
      </ser:recepcionMasivaFactura>
   </soapenv:Body>
</soapenv:Envelope>`;

    console.log("Enviando paquete MASIVO hacia SIAT...");
    const endpointToUse = (codigoDocumentoSector == 35 || codigoDocumentoSector == 1) ? 'https://pilotosiatservicios.impuestos.gob.bo/v2/ServicioFacturacionCompraVenta' : ENDPOINT_COMPUTARIZADA;
    const response = await sendSoapRequest(xml, endpointToUse, delegatedToken);
    
    if (response?.Envelope?.Body?.Fault) {
        return { success: false, mensaje: response.Envelope.Body.Fault.faultstring || "Error en envio masivo." };
    }

    const body = response?.Envelope?.Body?.recepcionMasivaFacturaResponse?.RespuestaServicioFacturacion;
    if (body && body.transaccion === 'true') {
        return { success: true, codigoRecepcion: body.codigoRecepcion, mensaje: "Paquete masivo recibido correctamente." };
    }
    console.error("DEBUG SIAT recepcionMasivaFactura FAIL:", JSON.stringify(body));
    return { success: false, mensaje: body?.mensajesList?.descripcion || JSON.stringify(body?.mensajesList) || "Respuesta no exitosa al enviar paquete masivo." };
}

async function validacionRecepcionPaqueteFactura(codigoSistema, nit, cuis, cufd, codigoAmbiente, codigoPuntoVenta, codigoSucursal, codigoRecepcion, codigoDocumentoSector, tipoFacturaDocumento, delegatedToken) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:validacionRecepcionPaqueteFactura>
         <SolicitudServicioValidacionRecepcionPaquete>
            <codigoAmbiente>${codigoAmbiente}</codigoAmbiente>
            <codigoDocumentoSector>${codigoDocumentoSector}</codigoDocumentoSector>
            <codigoEmision>2</codigoEmision>
            <codigoModalidad>2</codigoModalidad>
            <codigoPuntoVenta>${codigoPuntoVenta}</codigoPuntoVenta>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>${codigoSucursal}</codigoSucursal>
            <cufd>${cufd}</cufd>
            <cuis>${cuis}</cuis>
            <nit>${nit}</nit>
            <tipoFacturaDocumento>${tipoFacturaDocumento}</tipoFacturaDocumento>
            <codigoRecepcion>${codigoRecepcion}</codigoRecepcion>
         </SolicitudServicioValidacionRecepcionPaquete>
      </ser:validacionRecepcionPaqueteFactura>
   </soapenv:Body>
</soapenv:Envelope>`;

    console.log("Enviando validación de paquete hacia SIAT...");
    const endpointToUse = (codigoDocumentoSector == 35 || codigoDocumentoSector == 1) ? 'https://pilotosiatservicios.impuestos.gob.bo/v2/ServicioFacturacionCompraVenta' : ENDPOINT_COMPUTARIZADA;
    const response = await sendSoapRequest(xml, endpointToUse, delegatedToken);
    
    if (response?.Envelope?.Body?.Fault) {
        return { success: false, mensaje: response.Envelope.Body.Fault.faultstring || "Error en validación paquete." };
    }

    const body = response?.Envelope?.Body?.validacionRecepcionPaqueteFacturaResponse?.RespuestaServicioFacturacion;
    if (body && body.transaccion === 'true' && body.codigoEstado === '908') {
        return { success: true, codigoEstado: body.codigoEstado, mensaje: "Paquete VALIDADO correctamente." };
    }
    console.error("DEBUG SIAT validacionRecepcionPaqueteFactura FAIL:", JSON.stringify(body));
    return { success: false, codigoEstado: body?.codigoEstado, mensaje: body?.mensajesList?.descripcion || JSON.stringify(body?.mensajesList) || "Respuesta no exitosa al validar paquete." };
}

async function validacionRecepcionMasivaFactura(codigoSistema, nit, cuis, cufd, codigoPuntoVenta, codigoSucursal, codigoRecepcion, codigoDocumentoSector, delegatedToken, tipoFacturaDocumento = 1) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:validacionRecepcionMasivaFactura>
         <SolicitudServicioValidacionRecepcionMasiva>
            <codigoAmbiente>2</codigoAmbiente>
            <codigoDocumentoSector>${codigoDocumentoSector}</codigoDocumentoSector>
            <codigoEmision>3</codigoEmision>
            <codigoModalidad>2</codigoModalidad>
            <codigoPuntoVenta>${codigoPuntoVenta}</codigoPuntoVenta>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>${codigoSucursal}</codigoSucursal>
            <cufd>${cufd}</cufd>
            <cuis>${cuis}</cuis>
            <nit>${nit}</nit>
            <tipoFacturaDocumento>${tipoFacturaDocumento}</tipoFacturaDocumento>
            <codigoRecepcion>${codigoRecepcion}</codigoRecepcion>
         </SolicitudServicioValidacionRecepcionMasiva>
      </ser:validacionRecepcionMasivaFactura>
   </soapenv:Body>
</soapenv:Envelope>`;

    console.log("Enviando validación de paquete MASIVO hacia SIAT...");
    const endpointToUse = (codigoDocumentoSector == 35 || codigoDocumentoSector == 1) ? 'https://pilotosiatservicios.impuestos.gob.bo/v2/ServicioFacturacionCompraVenta' : ENDPOINT_COMPUTARIZADA;
    const response = await sendSoapRequest(xml, endpointToUse, delegatedToken);
    
    if (response?.Envelope?.Body?.Fault) {
        return { success: false, mensaje: response.Envelope.Body.Fault.faultstring || "Error en validación masiva." };
    }

    const body = response?.Envelope?.Body?.validacionRecepcionMasivaFacturaResponse?.RespuestaServicioFacturacion;
    if (body && body.transaccion === 'true' && body.codigoEstado === '908') {
        return { success: true, codigoEstado: body.codigoEstado, mensaje: "Paquete masivo VALIDADO correctamente." };
    }
    console.error("DEBUG SIAT validacionRecepcionMasivaFactura FAIL:", JSON.stringify(body));
    return { success: false, codigoEstado: body?.codigoEstado, mensaje: body?.mensajesList?.descripcion || JSON.stringify(body?.mensajesList) || "Respuesta no exitosa al validar paquete masivo." };
}

/**
 * Registro Punto de Venta
 */
async function registroPuntoVenta(codigoSistema, cuis, nit, codigoSucursal, codigoTipoPuntoVenta, descripcion, nombrePuntoVenta, delegatedToken) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:registroPuntoVenta>
         <SolicitudRegistroPuntoVenta>
            <codigoAmbiente>2</codigoAmbiente>
            <codigoModalidad>2</codigoModalidad>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>${codigoSucursal}</codigoSucursal>
            <codigoTipoPuntoVenta>${codigoTipoPuntoVenta}</codigoTipoPuntoVenta>
            <cuis>${cuis}</cuis>
            <descripcion>${descripcion}</descripcion>
            <nit>${nit}</nit>
            <nombrePuntoVenta>${nombrePuntoVenta}</nombrePuntoVenta>
         </SolicitudRegistroPuntoVenta>
      </ser:registroPuntoVenta>
   </soapenv:Body>
</soapenv:Envelope>`;

    console.log("Enviando registro de punto de venta hacia SIAT...");
    const response = await sendSoapRequest(xml, ENDPOINT_OPERACIONES, delegatedToken);
    
    if (!response.success) {
        return response;
    }
    
    try {
        const bodyObj = response.data['soap:Envelope']['soap:Body'][0];
        const resKey = Object.keys(bodyObj).find(k => k.includes('registroPuntoVentaResponse'));
        if (!resKey) {
            console.error("No se encontró registroPuntoVentaResponse en:", JSON.stringify(bodyObj));
            return { success: false, mensaje: "Respuesta inesperada del servidor" };
        }
        
        const respuestaObj = bodyObj[resKey][0];
        const innerKey = Object.keys(respuestaObj).find(k => k.includes('RespuestaRegistroPuntoVenta'));
        const body = respuestaObj[innerKey][0];
        
        if (body.transaccion && body.transaccion[0] === 'true') {
            return { 
                success: true, 
                codigoPuntoVenta: body.codigoPuntoVenta ? body.codigoPuntoVenta[0] : null
            };
        }
        
        return { success: false, mensaje: body?.mensajesList ? body.mensajesList[0].descripcion[0] : "Rechazo de registro de punto de venta" };
    } catch (e) {
        console.error("Error procesando respuesta registro PV:", e, JSON.stringify(response.data));
        return { success: false, mensaje: "Error procesando respuesta SIAT" };
    }
}


/**
 * Consulta de Compras a Confirmar
 */
async function consultaCompras(codigoSistema, nit, cuis, cufd, pv, fecha, delegatedToken) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:consultaCompras>
         <SolicitudConsultaCompras>
            <codigoAmbiente>2</codigoAmbiente>
            <codigoPuntoVenta>${pv}</codigoPuntoVenta>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>0</codigoSucursal>
            <cufd>${cufd}</cufd>
            <cuis>${cuis}</cuis>
            <nit>${nit}</nit>
            <fecha>${fecha}</fecha>
         </SolicitudConsultaCompras>
      </ser:consultaCompras>
   </soapenv:Body>
</soapenv:Envelope>`;

    console.log("Enviando Consulta Compras a Confirmar hacia SIAT...");
    const response = await sendSoapRequest(xml, ENDPOINT_COMPRAS, delegatedToken);

    if (response?.Envelope?.Body?.Fault) {
        return { success: false, mensaje: response.Envelope.Body.Fault.faultstring || "Error en consulta de compras." };
    }

    const body = response?.Envelope?.Body?.consultaComprasResponse?.RespuestaServicioFacturacion || response?.Envelope?.Body?.consultaComprasResponse?.RespuestaConsultaCompras;
    return body;
}

/**
 * Confirmación de Compras (Paquete de confirmacionCompra XMLs)
 */
async function confirmacionCompras(codigoSistema, nit, cuis, cufd, pv, archivoBase64, hash, fechaEnvio, gestion, periodo, cantidadFacturas, delegatedToken) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:confirmacionCompras>
         <SolicitudConfirmacionCompras>
            <codigoAmbiente>2</codigoAmbiente>
            <codigoPuntoVenta>${pv}</codigoPuntoVenta>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>0</codigoSucursal>
            <cufd>${cufd}</cufd>
            <cuis>${cuis}</cuis>
            <nit>${nit}</nit>
            <archivo>${archivoBase64}</archivo>
            <cantidadFacturas>${cantidadFacturas}</cantidadFacturas>
            <fechaEnvio>${fechaEnvio}</fechaEnvio>
            <gestion>${gestion}</gestion>
            <hashArchivo>${hash}</hashArchivo>
            <periodo>${periodo}</periodo>
         </SolicitudConfirmacionCompras>
      </ser:confirmacionCompras>
   </soapenv:Body>
</soapenv:Envelope>`;

    console.log("Enviando Confirmación de Compras hacia SIAT...");
    const response = await sendSoapRequest(xml, ENDPOINT_COMPRAS, delegatedToken);

    if (response?.Envelope?.Body?.Fault) {
        return { success: false, mensaje: response.Envelope.Body.Fault.faultstring || "Error en confirmación de compras." };
    }

    const body = response?.Envelope?.Body?.confirmacionComprasResponse?.RespuestaServicioFacturacion;
    return body;
}

/**
 * Recepcion de Paquete de Compras (Paquete de registroCompra XMLs)
 */
async function recepcionPaqueteCompras(codigoSistema, nit, cuis, cufd, pv, archivoBase64, hash, fechaEnvio, gestion, periodo, cantidadFacturas, delegatedToken) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:recepcionPaqueteCompras>
         <SolicitudRecepcionCompras>
            <codigoAmbiente>2</codigoAmbiente>
            <codigoPuntoVenta>${pv}</codigoPuntoVenta>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>0</codigoSucursal>
            <cufd>${cufd}</cufd>
            <cuis>${cuis}</cuis>
            <nit>${nit}</nit>
            <archivo>${archivoBase64}</archivo>
            <cantidadFacturas>${cantidadFacturas}</cantidadFacturas>
            <fechaEnvio>${fechaEnvio}</fechaEnvio>
            <gestion>${gestion}</gestion>
            <hashArchivo>${hash}</hashArchivo>
            <periodo>${periodo}</periodo>
         </SolicitudRecepcionCompras>
      </ser:recepcionPaqueteCompras>
   </soapenv:Body>
</soapenv:Envelope>`;

    console.log("Enviando Paquete de Compras hacia SIAT...");
    const response = await sendSoapRequest(xml, ENDPOINT_COMPRAS, delegatedToken);
    
    if (response?.Envelope?.Body?.Fault) {
        return { success: false, mensaje: response.Envelope.Body.Fault.faultstring || "Error en recepcion de compras." };
    }

    const body = response?.Envelope?.Body?.recepcionPaqueteComprasResponse?.RespuestaServicioFacturacion;
    return body;
}

/**
 * Validación de Recepción Paquete de Compras
 */
async function validacionRecepcionPaqueteCompras(codigoSistema, nit, cuis, cufd, pv, codigoRecepcion, delegatedToken) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:validacionRecepcionPaqueteCompras>
         <SolicitudValidacionRecepcionCompras>
            <codigoAmbiente>2</codigoAmbiente>
            <codigoPuntoVenta>${pv}</codigoPuntoVenta>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>0</codigoSucursal>
            <cufd>${cufd}</cufd>
            <cuis>${cuis}</cuis>
            <nit>${nit}</nit>
            <codigoRecepcion>${codigoRecepcion}</codigoRecepcion>
         </SolicitudValidacionRecepcionCompras>
      </ser:validacionRecepcionPaqueteCompras>
   </soapenv:Body>
</soapenv:Envelope>`;

    console.log("Enviando Validación de Paquete de Compras hacia SIAT...");
    const response = await sendSoapRequest(xml, ENDPOINT_COMPRAS, delegatedToken);

    if (response?.Envelope?.Body?.Fault) {
        return { success: false, mensaje: response.Envelope.Body.Fault.faultstring || "Error en validación de paquete de compras." };
    }

    const body = response?.Envelope?.Body?.validacionRecepcionPaqueteComprasResponse?.RespuestaServicioFacturacion;
    return body;
}

/**
 * Anulación de Registro de Compras
 */
async function anulacionCompra(codigoSistema, nit, cuis, cufd, pv, nitProveedor, codigoAutorizacion, nroFactura, delegatedToken) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="https://siat.impuestos.gob.bo/">
   <soapenv:Header/>
   <soapenv:Body>
      <ser:anulacionCompra>
         <SolicitudanulacionCompra>
            <codigoAmbiente>2</codigoAmbiente>
            <codigoPuntoVenta>${pv}</codigoPuntoVenta>
            <codigoSistema>${codigoSistema}</codigoSistema>
            <codigoSucursal>0</codigoSucursal>
            <cufd>${cufd}</cufd>
            <cuis>${cuis}</cuis>
            <nit>${nit}</nit>
            <codAutorizacion>${codigoAutorizacion || '1'}</codAutorizacion>
            <nitProveedor>${nitProveedor}</nitProveedor>
            <nroDuiDim>0</nroDuiDim>
            <nroFactura>${nroFactura}</nroFactura>
         </SolicitudanulacionCompra>
      </ser:anulacionCompra>
   </soapenv:Body>
</soapenv:Envelope>`;

    console.log("Enviando Anulación de Compra hacia SIAT...");
    const response = await sendSoapRequest(xml, ENDPOINT_COMPRAS, delegatedToken);

    if (response?.Envelope?.Body?.Fault) {
        return { success: false, mensaje: response.Envelope.Body.Fault.faultstring || "Error en anulación de compra." };
    }

    const body = response?.Envelope?.Body?.anulacionCompraResponse?.RespuestaServicioFacturacion;
    return body;
}

module.exports = {
    verificarComunicacion,
    solicitarCuis,
    solicitarCufd,
    recepcionFacturaComputarizada,
    recepcionDocumentoAjuste,
    sincronizarCatalogos,
    anulacionFactura,
    reversionAnulacionFactura,
    registroEventoSignificativo,
    recepcionPaqueteFactura,
    validacionRecepcionPaqueteFactura,
    recepcionMasivaFactura,
    validacionRecepcionMasivaFactura,
    registroPuntoVenta,
    consultaCompras,
    confirmacionCompras,
    recepcionPaqueteCompras,
    validacionRecepcionPaqueteCompras,
    anulacionCompra
};









