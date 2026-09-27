import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export const meta: MetaFunction = () => [
  { title: "EU TRACKER COURIER · Preparación automática de pedidos para Shopify" },
  {
    name: "description",
    content:
      "Prepara automáticamente todos los pedidos de tu tienda cada madrugada, con número de seguimiento y página de seguimiento para tus clientes.",
  },
];

export default function Landing() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>EU TRACKER COURIER</h1>
        <p className={styles.text}>
          Prepara solo todos los pedidos de tu tienda, a una hora aleatoria de la madrugada, con su
          número de seguimiento y una página de seguimiento para tus clientes.
        </p>

        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Dominio de tu tienda</span>
              <input className={styles.input} type="text" name="shop" placeholder="mi-tienda.myshopify.com" />
              <span>Ejemplo: mi-tienda.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Instalar
            </button>
          </Form>
        )}

        <ul className={styles.list}>
          <li>
            <strong>Preparación automática.</strong> Cada día, a una hora distinta y aleatoria dentro
            de tu ventana horaria.
          </li>
          <li>
            <strong>Números de seguimiento propios.</strong> Formato EU + 18 dígitos con dígitos de
            control.
          </li>
          <li>
            <strong>Seguimiento para el cliente.</strong> Página pública en el dominio de tu tienda y
            bloque para el tema.
          </li>
          <li>
            <strong>Multitienda.</strong> Instálala en todas tus tiendas; cada una con sus propios
            ajustes.
          </li>
        </ul>

        <p className={styles.text}>
          <a href="/track">Consultar un número de seguimiento</a>
        </p>
      </div>
    </div>
  );
}
