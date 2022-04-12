import jwt from "jsonwebtoken"
import { Octokit } from "octokit"
import { GraphQLDateTime } from "graphql-iso-date"
import type { Context } from "./context"
import { sendEmail } from "utils/email"

const resolvers = {
    Date: GraphQLDateTime,

    Query: {
        repositories: (_parent: null, _args: null, ctx: Context) => {
            const { token } = ctx.req.user
            console.log({ token })
            return ctx.db.repository.findMany({ where: { owner: { token } } })
        },
    },

    Mutation: {
        createShareableLink: async (
            _parent: null,
            { input }: any,
            ctx: Context
        ) => {
            const { token } = ctx.req.user
            if (!token) throw Error("Unauthorized")
            // TODO - verify that token matches ownerId

            const shareToken = jwt.sign(
                { repoId: input.repoId },
                String(process.env.JWT_SECRET)
            )
            const link = `${process.env.NEXT_PUBLIC_URI}/share/${shareToken}`
            // save the repository and the token in the database
            try {
                await ctx.db.repository.create({
                    data: {
                        name: input.name,
                        fullname: input.fullname,
                        repoId: input.repoId,
                        ownerId: input.ownerId,
                        htmlUrl: input.htmlUrl,
                        shareableLink: link,
                    },
                })
            } catch (err) {
                console.error(err)
            }

            return link
        },

        addCollaborator: async (
            _parent: null,
            {
                input: { repoId, joiner },
            }: {
                input: {
                    repoId: number
                    joiner: string
                }
            },
            ctx: Context
        ) => {
            const token = ctx.req.user.token
            if (!token) throw Error("Unauthorized")

            const repo = await ctx.db.repository.findUnique({
                where: { repoId },
                include: { owner: true },
            })
            if (!repo) throw Error("Repo Not Found")

            // FIXME - handle user already invited
            let octokit = new Octokit({ auth: repo.owner.token })
            const { data } = await octokit.request(
                "PUT /repos/{owner}/{repo}/collaborators/{username}",
                {
                    owner: repo.owner.login,
                    repo: repo.name,
                    username: joiner,
                }
            )
            const invitationId = data.id

            octokit = new Octokit({ auth: token })
            await octokit.request(
                "PATCH /user/repository_invitations/{invitation_id}",
                { invitation_id: invitationId }
            )

            // send email to the owner
            // TODO - format a bit better and add links to joiner profile and repo page
            await sendEmail({
                recipient: repo.owner.email,
                subject: `Someone joined ${repo.name}`,
                body: `Hey ${repo.owner.login},\n${joiner} just joined your private repo ${repo.fullname}.\
                \nDon't want to keep sharing this repo? Click here to close the gates`,
            })
            return true
        },
    },
}

export default resolvers
