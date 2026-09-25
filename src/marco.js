/**
 * La vista de tres pantallas (#/tres) pone a la empresa, la tienda y el
 * trabajador lado a lado, cada una en su propio marco (iframe) y con su
 * propia sesion. Este modulo es lo que cada marco necesita saber de eso.
 *
 * LA SESION DE CADA MARCO viaja en el nombre del marco (`window.name`), no
 * en la URL: el nombre nunca se envia al servidor ni queda en los registros.
 * La API la manda en una cabecera, que tiene prioridad sobre la cookie; asi
 * tres sesiones distintas conviven en un solo navegador.
 *
 * LOS MENSAJES entre marcos pasan por la pagina que los contiene, y solo se
 * aceptan del mismo origen:
 *  - la tienda anuncia el QR que esta mostrando, y el trabajador puede
 *    "escanearlo" con un clic, porque una computadora no apunta su camara
 *    a su propia pantalla;
 *  - la pagina "pasa" la tarjeta impresa de Rosa por la tienda;
 *  - cuando algo cambia en un marco, los demas recargan sus datos.
 */
import { reactive } from 'vue';

const PREFIJO = 'stellarrail:';

export const credencialDelMarco = typeof window !== 'undefined' && window.name.startsWith(PREFIJO)
  ? window.name.slice(PREFIJO.length)
  : null;

export const enMarco = Boolean(credencialDelMarco) && window.parent !== window;

/** Lo que otra pantalla puso "al alcance" de esta. */
export const cercano = reactive({
  qr: null,        // enlace del QR que muestra la tienda de al lado
  tarjeta: null,   // numero de la tarjeta que se acerca a esta tienda
  cambios: 0,      // sube cada vez que otra pantalla cambio algo
});

function alPadre(mensaje) {
  if (enMarco) window.parent.postMessage(mensaje, window.location.origin);
}

/** La tienda anuncia el QR que esta mostrando (o null si ya no muestra ninguno). */
export const anunciarQr = (enlace) => alPadre({ tipo: 'stellarrail-qr', enlace: enlace ?? null });

/** Algo cambio aqui: que las otras pantallas recarguen. */
export const avisarCambio = () => alPadre({ tipo: 'stellarrail-cambio' });

if (enMarco) {
  window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin || e.source !== window.parent) return;
    const m = e.data ?? {};
    if (m.tipo === 'stellarrail-qr') cercano.qr = m.enlace ?? null;
    else if (m.tipo === 'stellarrail-tarjeta') cercano.tarjeta = m.numero ?? null;
    else if (m.tipo === 'stellarrail-cambio') cercano.cambios += 1;
  });
}

/** Nombre que la pagina de tres pantallas le pone a cada marco. */
export const nombreDeMarco = (credencial) => `${PREFIJO}${credencial}`;
