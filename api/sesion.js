/**
 * /api/sesion
 *
 *   GET               quien soy. Si es la primera visita, crea el espacio de
 *                     una empresa nueva y este dispositivo es su empresa.
 *   POST { token }    entrar con una invitacion, como trabajador o comercio.
 *
 * No hay contrasenas. La empresa recibe aqui sus enlaces de invitacion y los
 * comparte; cada invitado los abre en su celular.
 */
import {
  cuerpo, identidad, json, manejar, riel, tokenDeInvitacion, unirse,
} from '../lib/http.js';

function perfil(yo) {
  const r = riel();
  const salida = {
    sesion: yo.sesion,
    rol: yo.rol,
    id: yo.id,
    emisor: r.emisor,
    activo: r.assetCode,
    horizon: r.horizonUrl,
  };
  if (yo.rol === 'empresa') {
    salida.invitaciones = {
      beneficiario: tokenDeInvitacion(yo.sesion, 'beneficiario'),
      comercio: tokenDeInvitacion(yo.sesion, 'comercio'),
    };
  }
  return salida;
}

export default manejar({
  async GET(req, res) {
    json(res, 200, perfil(await identidad(req, res)));
  },

  async POST(req, res) {
    const { token } = await cuerpo(req);
    const r = await unirse(req, res, token);
    if (r.error) return json(res, r.estado, { error: r.error });
    return json(res, 200, perfil(r.yo));
  },
});
