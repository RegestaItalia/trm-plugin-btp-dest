import { getCommons } from "./commons";
import { SapPassport } from "./SapPassport";

export type LoginData = { email: string, password: string } | { passport: SapPassport };

// prompts only for the values not already provided, with a SAP Passport email and password are not needed
export async function promptLogin(provided: { email?: string, password?: string, passport?: string, passportPassphrase?: string } = {}): Promise<LoginData> {
    const passport = provided.passport;
    const answers = await getCommons().Inquirer.prompt([{
        type: `input`,
        name: `email`,
        message: `BTP Login: Email`,
        when: () => !passport && !provided.email
    },
    {
        type: `password`,
        name: `password`,
        message: `BTP Login: Password`,
        when: () => !passport && !provided.password
    },
    {
        type: `password`,
        name: `passportPassphrase`,
        message: `SAP Passport passphrase`,
        when: () => !!passport && provided.passportPassphrase === undefined
    }]);
    if (passport) {
        return {
            passport: new SapPassport(passport, provided.passportPassphrase ?? answers.passportPassphrase)
        };
    }
    return {
        email: provided.email || answers.email,
        password: provided.password || answers.password
    };
}
