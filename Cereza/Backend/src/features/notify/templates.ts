/**
 * notify/templates.ts — Plantillas de email tipadas.
 *
 * Las plantillas son texto plano + HTML embebido. No usamos motores externos
 * (Handlebars, etc.) para mantener la dependencia mínima — son emails simples.
 */
export interface EmailRender {
  subject: string;
  html: string;
  text: string;
}

const wrap = (title: string, body: string): string => `
<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>${title}</title></head>
<body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width:560px; margin:0 auto; padding:24px; color:#1f2937;">
  <div style="border-bottom:1px solid #e5e7eb; padding-bottom:12px; margin-bottom:16px;">
    <h1 style="margin:0; font-size:20px; color:#0f766e;">CaféVision</h1>
  </div>
  ${body}
  <div style="border-top:1px solid #e5e7eb; padding-top:12px; margin-top:24px; font-size:12px; color:#6b7280;">
    Este es un mensaje automático. No respondas a este correo.
  </div>
</body></html>`;

export const templates = {
  verifyEmail(name: string, link: string): EmailRender {
    return {
      subject: 'Verifica tu correo en CaféVision',
      html: wrap('Verifica tu correo', `
        <p>Hola ${escapeHtml(name)},</p>
        <p>Gracias por registrarte en CaféVision. Confirma tu correo haciendo clic en el siguiente botón:</p>
        <p><a href="${link}" style="display:inline-block; background:#0f766e; color:#fff; padding:10px 18px; text-decoration:none; border-radius:6px;">Verificar correo</a></p>
        <p>O copia este enlace en tu navegador:<br><span style="word-break:break-all;">${link}</span></p>
        <p>El enlace expira en 24 horas.</p>
      `),
      text: `Hola ${name},\n\nVerifica tu correo en CaféVision:\n${link}\n\nEl enlace expira en 24 horas.`,
    };
  },

  resetPassword(name: string, link: string): EmailRender {
    return {
      subject: 'Restablece tu contraseña — CaféVision',
      html: wrap('Restablece tu contraseña', `
        <p>Hola ${escapeHtml(name)},</p>
        <p>Recibimos una solicitud para restablecer tu contraseña. Si no fuiste tú, ignora este mensaje.</p>
        <p><a href="${link}" style="display:inline-block; background:#0f766e; color:#fff; padding:10px 18px; text-decoration:none; border-radius:6px;">Restablecer contraseña</a></p>
        <p>El enlace expira en 1 hora.</p>
      `),
      text: `Hola ${name},\n\nRestablece tu contraseña:\n${link}\n\nExpira en 1 hora.`,
    };
  },

  analysisCompleted(name: string, analysisId: string, score: number, link: string): EmailRender {
    return {
      subject: `Análisis #${analysisId.slice(0, 8)} completado — Puntaje ${score.toFixed(1)}/100`,
      html: wrap('Análisis completado', `
        <p>Hola ${escapeHtml(name)},</p>
        <p>Tu análisis de calidad de café ha terminado. Puntaje general: <strong>${score.toFixed(1)}/100</strong>.</p>
        <p><a href="${link}" style="display:inline-block; background:#0f766e; color:#fff; padding:10px 18px; text-decoration:none; border-radius:6px;">Ver resultados</a></p>
      `),
      text: `Análisis completado. Puntaje: ${score.toFixed(1)}/100.\n${link}`,
    };
  },
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
