import Head from "next/head";
import { Inter } from "next/font/google";
import "../styles/globals.css";

import { ChatAppProvider } from "../Context/ChatAppContext";
import { NavBar } from "../Components/index";

const inter = Inter({ subsets: ["latin"] });

const MyApp = ({ Component, pageProps }) => (
  <div className={inter.className}>
    <Head>
      <title>Node Connect</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
    </Head>
    <ChatAppProvider>
      <NavBar />
      <main>
        <Component {...pageProps} />
      </main>
    </ChatAppProvider>
  </div>
);

export default MyApp;
