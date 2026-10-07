const express = require('express');
const cors = require('cors');
const zlib = require('zlib');
const crypto = require('crypto');
const { verificarComunicacion, solicitarCuis, solicitarCufd, recepcionFacturaComputarizada } = require('./siatSoapClient');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Ruta para verificar conexiÃ³n (Ping)
app.post('/api/siat/ping', async (req, res) => {
    try {
        const { systemCode, delegatedToken } = req.body;
        if (!systemCode) {
            return res.status(400).json({ success: false, mensaje: 'CÃ³digo de Sistema es requerido' });
        }
        if (!delegatedToken) {
            return res.status(400).json({ success: false, mensaje: 'Token Delegado es requerido para consumir SIAT' });
        }
        
        console.log("Recibida peticiÃ³n de Ping para el sistema:", systemCode);
        const result = await verificarComunicacion(delegatedToken);
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, mensaje: 'Error interno del servidor SIAT Backend' });
    }
});

// Ruta para solicitar CUIS
app.post('/api/siat/cuis', async (req, res) => {
    try {
        const { systemCode, companyId, delegatedToken, nit, sucursal = 0, puntoVenta = 0 } = req.body;
        if (!systemCode || !delegatedToken || !nit) {
            return res.status(400).json({ success: false, mensaje: 'Faltan parÃ¡metros obligatorios (systemCode, delegatedToken, nit)' });
        }
        
        const result = await solicitarCuis(systemCode, nit, 2, 2, puntoVenta, sucursal, delegatedToken);
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, mensaje: 'Error obteniendo CUIS' });
    }
});

// Ruta para solicitar CUFD
app.post('/api/siat/cufd', async (req, res) => {
    try {
        const { systemCode, cuis, companyId, delegatedToken, nit } = req.body;
        if (!systemCode || !cuis || !delegatedToken || !nit) {
            return res.status(400).json({ success: false, mensaje: 'Faltan parÃ¡metros obligatorios (systemCode, cuis, delegatedToken, nit)' });
        }
        
        const result = await solicitarCufd(systemCode, nit, cuis, 2, 2, 0, 0, delegatedToken);
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, mensaje: 'Error obteniendo CUFD' });
    }
});

// Ruta para emitir Factura (Computarizada en LÃ­nea)
app.post('/api/siat/emitir', async (req, res) => {
    try {
        const { systemCode, cuis, cufd, nit, xmlContent, delegatedToken, tipoFacturaDocumento, codigoDocumentoSector, puntoVenta = 0 } = req.body;
        
        if (!xmlContent || !systemCode || !cuis || !cufd || !nit || !delegatedToken) {
            return res.status(400).json({ success: false, mensaje: 'Faltan parÃ¡metros obligatorios para emisiÃ³n' });
        }

        // 1. Calcular Hash (SHA256) del XML Original
        const hashArchivo = crypto.createHash('sha256').update(xmlContent, 'utf8').digest('hex');

        // 2. Comprimir en GZIP y codificar a Base64
        const compressedBuffer = zlib.gzipSync(Buffer.from(xmlContent, 'utf8'));
        const archivoBase64 = compressedBuffer.toString('base64');

        // Formatear FechaEnvio YYYY-MM-DDTHH:mm:ss.SSS
        const dateObj = new Date();
        dateObj.setUTCHours(dateObj.getUTCHours() - 4);
        const pad = (n, width) => n.toString().padStart(width, '0');
        const fechaEnvio = `${dateObj.getUTCFullYear()}-${pad(dateObj.getUTCMonth()+1, 2)}-${pad(dateObj.getUTCDate(), 2)}T${pad(dateObj.getUTCHours(), 2)}:${pad(dateObj.getUTCMinutes(), 2)}:${pad(dateObj.getUTCSeconds(), 2)}.${pad(dateObj.getUTCMilliseconds(), 3)}`;

        // Llamar a SOAP (CÃ³digo Modalidad = 2, Ambiente = 2 Piloto)
        // codigoDocumentoSector = 1 (Compra Venta), codigoEmision = 1 (Online)
        const result = await recepcionFacturaComputarizada(
            systemCode, 
            nit, 
            cuis, 
            cufd, 
            2, // codigoAmbiente
            2, // codigoModalidad
            puntoVenta, // codigoPuntoVenta
            0, // codigoSucursal
            archivoBase64,
            hashArchivo,
            fechaEnvio,
            codigoDocumentoSector || 1, // codigoDocumentoSector
            1, // codigoEmision
            tipoFacturaDocumento || 1, // 1 = Con Credito Fiscal
            delegatedToken
        );

        res.json(result);

    } catch (error) {
        console.error("Error en emisiÃ³n de factura:", error);
        res.status(500).json({ success: false, mensaje: 'Error interno al emitir la factura' });
    }
});

// Ruta para Sincronizar CatÃ¡logos
app.post('/api/siat/catalogos', async (req, res) => {
    try {
        const { systemCode, cuis, nit, tipoCatalogo, delegatedToken } = req.body;
        const { sincronizarCatalogos } = require('./siatSoapClient');
        const result = await sincronizarCatalogos(systemCode, nit, cuis, 2, 0, 0, tipoCatalogo, delegatedToken);
        res.json(result);
    } catch (error) {
        console.error("Error sincronizando catÃ¡logos:", error);
        res.status(500).json({ success: false, mensaje: 'Error sincronizando catÃ¡logos' });
    }
});

// Ruta para Sincronizar CatÃ¡logos Masiva
app.post('/api/siat/hack-etapa2-massive', async (req, res) => {
    try {
        const { systemCode, cuis, nit, delegatedToken } = req.body;
        const script = require('../scripts/solve_etapa2_massive.cjs');
        script.runMassiveCatalogos(systemCode, delegatedToken, nit, cuis).catch(e => console.error("Batch error:", e));
        res.json({ success: true, message: 'Hack etapa 2 masivo started in background' });
    } catch (error) {
        console.error("Error iniciando etapa 2 masiva:", error);
        res.status(500).json({ success: false, mensaje: 'Error al iniciar etapa 2' });
    }
});

// Ruta para Anular Factura
app.post('/api/siat/anular', async (req, res) => {
    try {
        const { systemCode, cuis, cufd, nit, cuf, codigoMotivo, delegatedToken, puntoVenta = 0, tipoFacturaDocumento = 1, codigoDocumentoSector = 1 } = req.body;
        const { anulacionFactura } = require('./siatSoapClient');
        const result = await anulacionFactura(systemCode, nit, cuis, cufd, cuf, codigoMotivo || 1, puntoVenta, delegatedToken, tipoFacturaDocumento, codigoDocumentoSector);
        res.json(result);
    } catch (error) {
        console.error("Error al anular factura:", error);
        res.status(500).json({ success: false, mensaje: 'Error al anular factura' });
    }
});

app.post('/api/siat/hack-etapa4', async (req, res) => {
    try {
        const { systemCode, cuis, cufd, delegatedToken, nit, controlCode } = req.body;
        
        // Run in background with fresh script cache
        const scriptPath = require.resolve('../scripts/solve_etapa4_backend.cjs');
        delete require.cache[scriptPath];
        const script = require(scriptPath);
        script.runBatch(systemCode, cuis, cufd, delegatedToken, nit, controlCode).catch(e => console.error("Batch error:", e));
        res.json({ success: true, message: 'Hack started in background' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/siat/hack-etapa7', async (req, res) => {
    try {
        const { systemCode, cuis, cufd, delegatedToken, nit } = req.body;
        // Run script in background for Anulacion (Etapa 7)
        const scriptPath = require.resolve('../scripts/solve_etapa7_master.cjs');
        delete require.cache[scriptPath];
        const script = require(scriptPath);
        script.runBatch(systemCode, delegatedToken, nit).catch(e => console.error("Etapa 7 error:", e));
        res.json({ success: true, message: 'Hack Etapa 7 (Anulaciones) started in background' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/siat/hack-etapa8', async (req, res) => {
    try {
        const { systemCode, cuis, cufd, delegatedToken, nit } = req.body;
        // Run script in background for Reversion (Etapa 8 / XI)
        const scriptPath = require.resolve('../scripts/solve_etapa8_master.cjs');
        delete require.cache[scriptPath];
        const script = require(scriptPath);
        script.runBatch(systemCode, delegatedToken, nit).catch(e => console.error("Etapa 8 error:", e));
        res.json({ success: true, message: 'Hack Etapa 8 (Reversiones) started in background' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/siat/hack-etapa5', async (req, res) => {
    try {
        const { systemCode, cuis, cufd, delegatedToken, nit } = req.body;
        
        // Run in background
        const script = require('../scripts/solve_etapa5_backend.cjs');
        script.runBatch(systemCode, cuis, cufd, delegatedToken, nit).catch(e => console.error("Batch error:", e));
        res.json({ success: true, message: 'Hack etapa 5 started in background' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/siat/hack-etapa6', async (req, res) => {
    try {
        const { systemCode, cuis, cufd, delegatedToken, nit, controlCode } = req.body;
        
        // Run in background
        const script = require('../scripts/solve_etapa6_backend.cjs');
        script.runBatch(systemCode, cuis, cufd, delegatedToken, nit, controlCode).catch(e => console.error("Batch error:", e));
        res.json({ success: true, message: 'Hack etapa 6 started in background' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/siat/hack-etapa-compras', async (req, res) => {
    try {
        const { systemCode, delegatedToken, nit } = req.body;
        const script = require('../scripts/solve_etapa_compras_backend.cjs');
        script.runBatch(systemCode, null, null, delegatedToken, nit || "348190024").catch(e => console.error("Compras batch error:", e));
        res.json({ success: true, message: 'Hack Etapa XII (Compras) iniciado en segundo plano' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/siat/hack-validar-paquetes', async (req, res) => {
    try {
        const script = require('../solve_etapa12_portal_validation.cjs');
        script.runPortalValidation().catch(e => console.error("Validation error:", e));
        res.json({ success: true, message: 'Validación de paquetes iniciada en segundo plano' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/siat/hack-etapa1', async (req, res) => {
    try {
        const { systemCode, delegatedToken, nit } = req.body;
        
        // Run and wait for result
        const script = require('../scripts/solve_etapa1_manual.cjs');
        const result = await script.runBatch(systemCode, delegatedToken, nit);
        res.json({ success: result.success, message: result.success ? 'Etapa 1 completada' : `Error: ${result.lastError}` });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/siat/hack-registro-pv', async (req, res) => {
    try {
        const { systemCode, delegatedToken, nit } = req.body;
        const script = require('../scripts/solve_registro_pv.cjs');
        script.runRegistroPV(systemCode, delegatedToken, nit).catch(e => console.error(e));
        res.json({ success: true, message: 'Registro de PV en progreso' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/siat/hack-etapa3', async (req, res) => {
    try {
        const { systemCode, delegatedToken, nit } = req.body;
        const script = require('../scripts/solve_etapa3_manual.cjs');
        const result = await script.runBatchCufd(systemCode, delegatedToken, nit);
        res.json({ 
            success: result.success, 
            message: result.success ? 'Etapa 3 completada' : `Error: ${result.lastError}`,
            lastCufd: result.lastCufd 
        });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/siat/hack-etapa3-massive', async (req, res) => {
    try {
        const { systemCode, delegatedToken, nit } = req.body;
        // Run in background
        const script = require('../scripts/solve_etapa3_massive.cjs');
        script.runMassiveCufd(systemCode, delegatedToken, nit).catch(e => console.error("Batch error:", e));
        res.json({ success: true, message: 'Hack etapa 3 masivo started in background' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});


app.listen(PORT, () => {
    console.log(`✅ Servidor SIAT Backend (Piloto) corriendo en http://localhost:${PORT}`);
    console.log(`Modalidad configurada: Computarizada en Línea (Sin .p12)`);
});



