import { getCommons } from "./commons";

// prompts only for the values not already provided
export async function promptLogin(provided: { email?: string, password?: string } = {}): Promise<{ email: string, password: string }> {
    const answers = await getCommons().Inquirer.prompt([{
        type: `input`,
        name: `email`,
        message: `BTP Login: Email`,
        when: () => !provided.email
    },
    {
        type: `password`,
        name: `password`,
        message: `BTP Login: Password`,
        when: () => !provided.password
    }]);
    return {
        email: provided.email || answers.email,
        password: provided.password || answers.password
    };
}
