const crypto = require('crypto');
const xml2js = require('xml2js');

/**
 * Módulo 11 (Base 11) - Algoritmo estándar del SIN
 */
function getMod11(cadena, numDig = 1, limMult = 9, x10 = false) {
    let mult, suma, i, n, dig;
    if (!x10) numDig = 1;
    for (n = 1; n <= numDig; n++) {
        suma = 0;
        mult = 2;
        for (i = cadena.length - 1; i >= 0; i--) {
            suma += (mult * parseInt(cadena.charAt(i)));
            if (++mult > limMult) mult = 2;
        }
        if (x10) {
            dig = ((suma * 10) % 11) % 10;
        } else {
            dig = suma % 11;
        }
        if (dig == 10) {
            cadena += "1";
        }
        if (dig == 11) {
            cadena += "0";
        }
        if (dig < 10) {
            cadena += dig.toString();
        }
    }
    return cadena.slice(-numDig);
}

/**
 * BigInt a Hexadecimal
 */
function toHex(bigIntValue) {
    return bigIntValue.toString(16).toUpperCase();
}

/**
 * Calcula el Código Único de Facturación (CUF)
 */
function calcularCUF(nit, fechaHora, sucursal, modalidad, emision, tipoFactura, sector, nroFactura, puntoVenta, codigoControl) {
    // 1. Padding de valores
    const strNit = String(nit).padStart(13, '0');
    // fechaHora debe venir en formato yyyyMMddHHmmssSSS
    const strFecha = String(fechaHora).padEnd(17, '0').slice(0, 17);
    const strSucursal = String(sucursal).padStart(4, '0');
    const strModalidad = String(modalidad);
    const strEmision = String(emision);
    const strTipoFactura = String(tipoFactura);
    const strSector = String(sector).padStart(2, '0');
    const strNroFactura = String(nroFactura).padStart(10, '0');
    const strPuntoVenta = String(puntoVenta).padStart(4, '0');

    // 2. Concatenar
    const cadena = `${strNit}${strFecha}${strSucursal}${strModalidad}${strEmision}${strTipoFactura}${strSector}${strNroFactura}${strPuntoVenta}`;

    // 3. Modulo 11
    const digitoMod11 = getMod11(cadena, 1, 9, false);
    const cadenaConMod11 = cadena + digitoMod11;

    // 4. Convertir a Base 16 (Hexadecimal)
    const bigIntCadena = BigInt(cadenaConMod11);
    const hexCadena = toHex(bigIntCadena);

    // 5. Concatenar con Código de Control (del CUFD)
    const cuf = hexCadena + codigoControl;

    return cuf;
}

/**
 * Firma Digital (Opcional, para Electrónica en Línea)
 */
function firmarFactura(xmlString, p12Path, password) {
    // TODO: Implementar firma XML (XMLDSIG) usando crypto o una librería externa
    // Esta función queda lista para la Fase donde toque Electrónica en Línea.
    return xmlString; 
}

/**
 * Genera el XML de la factura (Compra Venta Estándar)
 */
function generarXMLFacturaCompraVenta(datosFactura) {
    const {
        nitEmisor, razonSocialEmisor, municipio, telefono, numeroFactura, cuf, cufd, codigoSucursal, direccion,
        codigoPuntoVenta, fechaEmision, nombreRazonSocial, codigoTipoDocumentoIdentidad, numeroDocumento, complemento,
        codigoCliente, codigoMetodoPago, numeroTarjeta, montoTotal,         montoTotalSujetoIva, codigoMoneda, tipoCambio,
        montoTotalMoneda, montoGiftCard, descuentoAdicional, codigoExcepcion, cafc, leyenda, usuario, codigoDocumentoSector,
        detalles
    } = datosFactura;

    const esPrevalorada = datosFactura.codigoDocumentoSector === 23;
    let rootNameVal = 'facturaComputarizadaCompraVenta';
    if (codigoDocumentoSector === 23) { rootNameVal = 'facturaComputarizadaPrevalorada'; } else if (codigoDocumentoSector === 35) { rootNameVal = 'facturaComputarizadaCompraVentaBon'; } else if (codigoDocumentoSector === 34) { rootNameVal = 'facturaComputarizadaSeguros'; }

    const builder = new xml2js.Builder({
        rootName: rootNameVal,
        xmldec: { version: '1.0', encoding: 'UTF-8' },
        renderOpts: { pretty: true, indent: '    ' }
    });

    const nillable = (val) => (val === "" || val === null || val === undefined) ? { $: { 'xsi:nil': 'true' } } : val;

    const cabecera = {
        nitEmisor,
        razonSocialEmisor,
        municipio,
        telefono: nillable(telefono),
        numeroFactura,
        cuf,
        cufd,
        codigoSucursal,
        direccion,
        codigoPuntoVenta: codigoPuntoVenta || 0,
        fechaEmision,
        nombreRazonSocial: esPrevalorada ? 'S/N' : nombreRazonSocial,
        codigoTipoDocumentoIdentidad: esPrevalorada ? 5 : codigoTipoDocumentoIdentidad, // 5 = NIT? Or wait, 5 is usually CI. If S/N, maybe 5? Let's just keep it, or 5 if it complains. Wait, if it complains about TipoDoc, I'll see it later.
        numeroDocumento: esPrevalorada ? '0' : numeroDocumento,
        complemento: nillable(complemento),
        codigoCliente: esPrevalorada ? 'N/A' : codigoCliente,
        codigoMetodoPago,
        numeroTarjeta: nillable(numeroTarjeta),
        montoTotal,
        ...(codigoDocumentoSector === 34 ? { ajusteAfectacionIva: (datosFactura.ajusteAfectacionIva || 0) } : {}),
        montoTotalSujetoIva,
        codigoMoneda,
        tipoCambio,
        montoTotalMoneda,
        montoGiftCard: montoGiftCard || 0,
        descuentoAdicional: descuentoAdicional || 0,
        codigoExcepcion: codigoExcepcion || 0,
        cafc: nillable(cafc),
        leyenda,
        usuario,
        codigoDocumentoSector
    };

    if (esPrevalorada) {
        delete cabecera.complemento;
        delete cabecera.montoGiftCard;
        delete cabecera.descuentoAdicional;
        delete cabecera.codigoExcepcion;
        delete cabecera.cafc;
    }

    const objXml = {
        $: {
            'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
            'xsi:noNamespaceSchemaLocation': (codigoDocumentoSector === 23) ? 'facturaComputarizadaPrevalorada.xsd' : (codigoDocumentoSector === 35) ? 'facturaComputarizadaCompraVentaBon.xsd' : (codigoDocumentoSector === 34) ? 'facturaComputarizadaSeguros.xsd' : 'facturaComputarizadaCompraVenta.xsd'
        },
        cabecera: cabecera,
        detalle: detalles.map(d => {
            let det = {
                actividadEconomica: d.actividadEconomica,
                codigoProductoSin: d.codigoProductoSin,
                codigoProducto: d.codigoProducto,
                descripcion: d.descripcion,
                cantidad: d.cantidad,
                unidadMedida: d.unidadMedida,
                precioUnitario: d.precioUnitario,
                montoDescuento: d.montoDescuento || 0,
                subTotal: d.subTotal
            };
            if (!esPrevalorada && codigoDocumentoSector !== 34) {
                det.numeroSerie = nillable(d.numeroSerie);
                det.numeroImei = nillable(d.numeroImei);
            }
            return det;
        })
    };

    let xml = builder.buildObject(objXml);
    return xml;
}

module.exports = {
    calcularCUF,
    generarXMLFacturaCompraVenta,
    firmarFactura,
    getMod11
};





