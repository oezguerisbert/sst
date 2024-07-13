import fs from "fs";
import path from "path";
import { SsrSite, SsrSiteNormalizedProps, SsrSiteProps } from "./SsrSite.js";
import { Construct } from "constructs";

export interface SolidStartSiteProps extends SsrSiteProps {
  /**
   * The server function is deployed to Lambda in a single region. Alternatively, you can enable this option to deploy to Lambda@Edge.
   * @default false
   */
  edge?: boolean;
}

type SolidStartSiteNormalizedProps = SolidStartSiteProps &
  SsrSiteNormalizedProps;

/**
 * The `SolidStartSite` construct is a higher level CDK construct that makes it easy to create a SolidStart app.
 * @example
 * Deploys a SolidStart app in the `my-solid-start-app` directory.
 *
 * ```js
 * new SolidStartSite(stack, "web", {
 *   path: "my-solid-start-app/",
 * });
 * ```
 */
export class SolidStartSite extends SsrSite {
  declare props: SolidStartSiteNormalizedProps;

  constructor(scope: Construct, id: string, props?: SolidStartSiteProps) {
    super(scope, id, props);
  }

  protected plan() {
    const { path: sitePath, edge } = this.props;

    const assetsPath = path.join(".output", "public");

    const nitro = JSON.parse(
      fs.readFileSync(path.join(sitePath, ".output/nitro.json")).toString()
    );

    if (!["aws-lambda-streaming", "aws-lambda"].includes(nitro.preset)) {
      throw new Error(
        `SST detected that your SolidStart app is configured with the "${nitro.preset}" preset. This preset is not supported by SST. We recommend you to use the "aws-lambda" or "aws-lambda-streaming" preset instead.`
      );
    }

    const serverConfig = {
      description: "Server handler for Solid",
      handler: "index.handler",
      bundle: path.join(sitePath, ".output", "server"),
      streaming: nitro.preset === "aws-lambda-streaming",
    };

    const buildMeta = {
      assetsPath,
      staticRoutes: fs
        .readdirSync(path.join(sitePath, assetsPath))
        .map((item) =>
          fs.statSync(path.join(sitePath, assetsPath, item)).isDirectory()
            ? `${item}/*`
            : item
        ),
    };

    return this.validatePlan({
      edge: edge ?? false,
      cloudFrontFunctions: {
        serverCfFunction: {
          constructId: "CloudFrontFunction",
          injections: [this.useCloudFrontFunctionHostHeaderInjection()],
        },
      },
      origins: {
        ...(edge
          ? {}
          : {
              server: {
                constructId: "ServerFunction",
                type: "function" as const,
                function: serverConfig,
              },
            }),
        s3: {
          type: "s3" as const,
          copy: [
            {
              from: buildMeta.assetsPath,
              to: "",
              cached: true,
            },
          ],
        },
      },
      behaviors: [
        edge
          ? {
              cacheType: "server" as const,
              cfFunction: "serverCfFunction",
              edgeFunction: "edgeServer",
              origin: "s3",
            }
          : {
              cacheType: "server",
              cfFunction: "serverCfFunction",
              origin: "server",
            },
        {
          pattern: "_server/",
          cacheType: "server",
          cfFunction: "serverCfFunction",
          origin: "server",
        },
        ...buildMeta.staticRoutes.map(
          (route) =>
            ({
              pattern: route,
              cacheType: "static",
              origin: "s3",
            } as const)
        ),
      ],
    });
  }

  public getConstructMetadata() {
    return {
      type: "SolidStartSite" as const,
      ...this.getConstructMetadataBase(),
    };
  }
}