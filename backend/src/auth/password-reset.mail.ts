import { Injectable } from '@nestjs/common';
import { html, type Mailable } from '@nestjs/mail';

export interface PasswordResetData {
  url: string;
}

@Injectable()
export class PasswordResetMail implements Mailable<PasswordResetData> {
  render({ url }: PasswordResetData) {
    return {
      subject: 'Restablece tu contraseña — InflatCO',
      html: html`
        <p>Recibimos una solicitud para restablecer tu contraseña.</p>
        <p><a href="${url}">Restablecer contraseña</a></p>
        <p>
          El enlace vence en 1 hora. Si no la pediste tú, ignora este correo.
        </p>
      `,
    };
  }
}
