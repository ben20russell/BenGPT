import SearchInterface from './search-interface';

export default function Home() {
  const chatModel =
    process.env.AZURE_OPENAI_DEPLOYMENT ??
    process.env.AZURE_OPENAI_DEPLOYMENT_NAME ??
    process.env.AZURE_OPENAI_MODEL ??
    process.env.OPENAI_MODEL;

  return <SearchInterface chatModel={chatModel} />;
}
