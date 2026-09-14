import { notFound } from "next/navigation";
import { PublisherGamesEditor } from "@/components/publisher-games-editor";
import { getTopDownWorkbenchState } from "@/lib/top-down/server";

export const dynamic = "force-dynamic";

type PublisherPageProps = {
  params: Promise<{
    publisherKey: string;
  }>;
};

export default async function PublisherPage({ params }: PublisherPageProps) {
  const { publisherKey } = await params;
  const initialState = await getTopDownWorkbenchState();
  const exists = initialState.publishers.some((publisher) => publisher.key === publisherKey);

  if (!exists) {
    notFound();
  }

  return <PublisherGamesEditor initialState={initialState} publisherKey={publisherKey} />;
}
