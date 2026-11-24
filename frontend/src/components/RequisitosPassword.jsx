// Lista de requisitos de la contraseña que se marcan en vivo.
// La usan "Actualiza tu contraseña" (primer ingreso) y "Mi perfil".
// (Django vuelve a revisar lo mismo en CambiarPasswordForm al guardar)

export function revisarRequisitos(clave) {
  return [
    { texto: 'Mínimo 9 caracteres', ok: clave.length >= 9 },
    { texto: 'Al menos una mayúscula', ok: /[A-Z]/.test(clave) },
    { texto: 'Al menos un número', ok: /[0-9]/.test(clave) },
    { texto: 'Al menos un carácter especial', ok: /[^A-Za-z0-9]/.test(clave) },
  ]
}

export default function RequisitosPassword({ clave }) {
  return (
    <ul className="list-unstyled bg-light rounded-3 p-3 small mb-4">
      {revisarRequisitos(clave).map((r) =>
        r.ok ? (
          <li key={r.texto} className="text-success mb-1">✓ <span className="text-dark">{r.texto}</span></li>
        ) : (
          <li key={r.texto} className="text-secondary mb-1">○ {r.texto}</li>
        )
      )}
    </ul>
  )
}
