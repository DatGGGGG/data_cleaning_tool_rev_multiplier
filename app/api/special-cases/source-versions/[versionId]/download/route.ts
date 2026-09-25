import { requireMappingArtifactCapability } from "@/lib/mapping-artifacts/auth";
import { downloadSpecialCaseSource } from "@/lib/special-cases/server";
export async function GET(request:Request,{params}:{params:Promise<{versionId:string}>}) { await requireMappingArtifactCapability(request,"read");const file=await downloadSpecialCaseSource((await params).versionId);return new Response(file.content,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${file.filename}"`}}); }
